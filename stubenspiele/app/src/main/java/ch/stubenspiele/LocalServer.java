package ch.stubenspiele;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/** Kleiner HTTP-Server für Mitspieler im WLAN. Läuft nur, während ein WLAN-Tisch gehostet wird.
 *  Statische Dateien kommen aus den Assets, /api/* geht an die JS-Engine im WebView. */
public class LocalServer {
    public static final int DEFAULT_PORT = 3000;
    private final Context ctx;
    private final WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, Socket> pending = new ConcurrentHashMap<>();
    private final Map<String, Socket> streams = new ConcurrentHashMap<>();
    private final AtomicLong ids = new AtomicLong(1);
    private ServerSocket ss;
    private volatile boolean running;
    public int port;

    public LocalServer(Context ctx, WebView web) { this.ctx = ctx; this.web = web; }

    private volatile boolean isPublic = false;
    /** Bindet den Server: für Mitspieler auf allen Schnittstellen (pub), sonst nur auf 127.0.0.1. */
    private void bind(boolean pub) throws IOException {
        IOException last = null;
        ServerSocket old = ss;
        if (old != null) { try { old.close(); } catch (IOException ignored) {} }
        for (int p = (port > 0 ? port : DEFAULT_PORT); p < DEFAULT_PORT + 11; p++) {
            try { ServerSocket n = new ServerSocket(); n.setReuseAddress(true); n.bind(new InetSocketAddress(pub ? "0.0.0.0" : "127.0.0.1", p)); ss = n; port = p; last = null; break; }
            catch (IOException e) { last = e; }
        }
        if (last != null) throw last;
        isPublic = pub;
    }
    /** Vom JS aufgerufen: true = Tisch im WLAN eröffnet (von außen erreichbar), false = wieder schließen. */
    public synchronized void setPublic(boolean pub) {
        if (pub == isPublic) return;
        try { bind(pub); } catch (IOException e) { /* alter Zustand bleibt */ }
    }
    public boolean isPublic() { return isPublic; }

    public int start() throws IOException {
        bind(true);
        running = true;
        Thread t = new Thread(new Runnable() { public void run() {
            while (running) {
                ServerSocket cur = ss;
                try { final Socket s = cur.accept(); pool.execute(new Runnable() { public void run() { handle(s); } }); }
                catch (IOException e) { if (running) try { Thread.sleep(50); } catch (InterruptedException ignored) {} }
            } } }, "accept");
        t.setDaemon(true); t.start();
        Thread hb = new Thread(new Runnable() { public void run() {
            while (running) {
                try { Thread.sleep(20000); } catch (InterruptedException e) { return; }
                for (Map.Entry<String, Socket> e : streams.entrySet()) writeStream(e.getKey(), ": ping\n\n");
            } } }, "heartbeat");
        hb.setDaemon(true); hb.start();
        return port;
    }

    public void stop() { running = false; try { if (ss != null) ss.close(); } catch (IOException ignored) {} pool.shutdownNow(); }

    /** Nur WLAN/Hotspot-Adressen; VPN-Tunnel (tun) und Mobilfunk (rmnet, ccmni) sind für Mitspieler nutzlos. */
    public List<String> urls() { return urls(port); }
    public static List<String> urls(int port) {
        List<String> wifi = new ArrayList<>(), rest = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName();
                if (n.startsWith("tun") || n.startsWith("ppp") || n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("clat") || n.startsWith("dummy")) continue;
                boolean isWifi = n.startsWith("wlan") || n.startsWith("swlan") || n.startsWith("ap") || n.startsWith("eth") || n.startsWith("p2p");
                for (InetAddress a : Collections.list(ni.getInetAddresses()))
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) (isWifi ? wifi : rest).add("http://" + a.getHostAddress() + ":" + port);
            }
        } catch (Exception ignored) {}
        return wifi.isEmpty() ? rest : wifi;
    }

    private void handle(Socket sock) {
        try {
            sock.setSoTimeout(0);
            InputStream in = sock.getInputStream();
            // Kopf lesen bis \r\n\r\n
            ByteArrayOutputStream head = new ByteArrayOutputStream();
            int b, state = 0;
            while ((b = in.read()) != -1) {
                head.write(b);
                if (state == 0 && b == '\r') state = 1; else if (state == 1 && b == '\n') state = 2; else if (state == 2 && b == '\r') state = 3; else if (state == 3 && b == '\n') break; else state = (b == '\r') ? 1 : 0;
                if (head.size() > 65536) { sock.close(); return; }
            }
            String[] lines = head.toString("ISO-8859-1").split("\r\n");
            if (lines.length == 0 || lines[0].isEmpty()) { sock.close(); return; }
            String[] req = lines[0].split(" ");
            String method = req[0]; String target = req.length > 1 ? req[1] : "/";
            int len = 0;
            for (String l : lines) if (l.toLowerCase().startsWith("content-length:")) len = Integer.parseInt(l.substring(15).trim());
            byte[] body = new byte[len]; int got = 0;
            while (got < len) { int r = in.read(body, got, len - got); if (r == -1) break; got += r; }
            String path = target, query = "";
            int q = target.indexOf('?'); if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }

            if (method.equals("OPTIONS")) { // CORS-Vorabfrage: Gäste-Apps sprechen den Gastgeber von ihrer eigenen App aus an
                OutputStream out = sock.getOutputStream();
                out.write(("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Max-Age: 86400\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.flush(); sock.close(); return;
            }
            if (method.equals("GET") && (path.equals("/") || path.equals("/index.html"))) { serveAsset(sock, "index.html", "text/html; charset=utf-8"); return; }
            if (method.equals("GET") && path.equals("/engine.js")) { serveAsset(sock, "engine.js", "application/javascript; charset=utf-8"); return; }
            if (method.equals("GET") && path.equals("/mqtt.min.js")) { serveAsset(sock, "mqtt.min.js", "application/javascript; charset=utf-8"); return; }
            if (method.equals("GET") && path.equals("/qrcode.js")) { serveAsset(sock, "qrcode.js", "application/javascript; charset=utf-8"); return; }
            if (method.equals("GET") && path.equals("/version.js")) { serveAsset(sock, "version.js", "application/javascript; charset=utf-8"); return; }
            if (method.equals("GET") && path.equals("/api/events")) {
                String code = param(query, "code"), pid = param(query, "pid"), token = param(query, "token");
                final String id = "s" + ids.getAndIncrement();
                OutputStream out = sock.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\nretry: 2000\n\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
                streams.put(id, sock);
                final String js = "Engine.subscribe(" + jsStr(id) + "," + jsStr(code) + "," + jsStr(pid) + "," + jsStr(token) + ")";
                ui.post(new Runnable() { public void run() { web.evaluateJavascript(js, null); } });
                try { while (in.read() != -1) { /* offen halten, bis der Client zumacht */ } } catch (IOException ignored) {}
                streams.remove(id);
                ui.post(new Runnable() { public void run() { web.evaluateJavascript("Engine.unsubscribe(" + jsStr(id) + ")", null); } });
                try { sock.close(); } catch (IOException ignored) {}
                return;
            }
            if (method.equals("POST") && path.startsWith("/api/")) {
                final String id = "r" + ids.getAndIncrement();
                pending.put(id, sock);
                final String js = "Engine.request(" + jsStr(id) + "," + jsStr(path) + "," + jsStr(new String(body, StandardCharsets.UTF_8)) + ")";
                ui.post(new Runnable() { public void run() { web.evaluateJavascript(js, null); } });
                pool.execute(new Runnable() { public void run() {
                    try { Thread.sleep(8000); } catch (InterruptedException e) { return; }
                    if (pending.containsKey(id)) respond(id, 503, "{\"error\":\"Server antwortet nicht. Ist die App auf dem Host-Handy offen?\"}");
                } });
                return;
            }
            writeResponse(sock, 404, "text/plain; charset=utf-8", "Nicht gefunden".getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            try { sock.close(); } catch (IOException ignored) {}
        }
    }

    public void respond(String id, final int status, String body) {
        final Socket s = pending.remove(id); if (s == null) return;
        final byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        pool.execute(new Runnable() { public void run() { writeResponse(s, status, "application/json; charset=utf-8", bytes); } });
    }

    public void push(String id, String data) {
        StringBuilder sb = new StringBuilder();
        for (String line : data.split("\n")) sb.append("data: ").append(line).append('\n');
        sb.append('\n');
        writeStream(id, sb.toString());
    }

    public void closeStream(String id) { Socket s = streams.remove(id); if (s != null) try { s.close(); } catch (IOException ignored) {} }

    private void writeStream(String id, String text) {
        Socket s = streams.get(id); if (s == null) return;
        try { synchronized (s) { OutputStream o = s.getOutputStream(); o.write(text.getBytes(StandardCharsets.UTF_8)); o.flush(); } }
        catch (IOException e) { streams.remove(id); try { s.close(); } catch (IOException ignored) {} }
    }

    private void serveAsset(Socket sock, String name, String type) throws IOException {
        InputStream a = ctx.getAssets().open(name);
        ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int r;
        while ((r = a.read(buf)) != -1) bo.write(buf, 0, r);
        a.close();
        writeResponse(sock, 200, type, bo.toByteArray());
    }

    private void writeResponse(Socket sock, int status, String type, byte[] body) {
        try {
            String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 403 ? "Forbidden" : status == 409 ? "Conflict" : status == 503 ? "Service Unavailable" : "Error";
            OutputStream out = sock.getOutputStream();
            out.write(("HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length + "\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(body); out.flush();
        } catch (IOException ignored) {}
        try { sock.close(); } catch (IOException ignored) {}
    }

    private static String param(String query, String key) {
        for (String kv : query.split("&")) { int i = kv.indexOf('='); if (i > 0 && kv.substring(0, i).equals(key)) try { return URLDecoder.decode(kv.substring(i + 1), "UTF-8"); } catch (Exception e) { return ""; } }
        return "";
    }

    /** JSON/JS-String-Literal, damit Inhalte sicher in evaluateJavascript landen. */
    static String jsStr(String s) {
        if (s == null) return "\"\"";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case ' ': sb.append("\\u2028"); break;
                case ' ': sb.append("\\u2029"); break;
                default: if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
