package ch.stubenspiele;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Die Oberfläche kommt direkt aus den App-Dateien (abgefangene Anfragen an einen internen Hostnamen),
 * es läuft also kein Netzwerk-Server, solange niemand einen WLAN-Tisch eröffnet. Erst dann startet
 * der kleine HTTP-Server für die Mitspieler – und wird beim Verlassen des Tisches wieder beendet.
 */
public class MainActivity extends Activity {
    /** Interner Hostname nur für die App-eigene Oberfläche; wird nie im Netz angefragt. */
    private static final String APP_HOST = "stubenspiele.local";
    private WebView web;
    private LocalServer server; // nur gesetzt, während ein WLAN-Tisch gehostet wird
    private volatile boolean updating = false, installPending = false;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u == null || !APP_HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.equals("/index.html")) path = "/index.html";
                String name = path.substring(1);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                if (name.contains("..") || name.contains("/")) return notFound(headers);
                String mime = name.endsWith(".js") ? "application/javascript" : name.endsWith(".html") ? "text/html" : name.endsWith(".json") ? "application/json" : "application/octet-stream";
                try {
                    InputStream in = getAssets().open(name);
                    WebResourceResponse res = new WebResourceResponse(mime, "utf-8", in);
                    res.setResponseHeaders(headers);
                    return res;
                } catch (IOException e) { return notFound(headers); }
            }
            private WebResourceResponse notFound(Map<String, String> headers) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream("Nicht gefunden".getBytes(StandardCharsets.UTF_8)));
            }
        });
        web.setBackgroundColor(0xFF153527);
        web.addJavascriptInterface(new Bridge(), "Bridge");
        setContentView(web);
        web.loadUrl("http://" + APP_HOST + "/");
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Zurück aus den Einstellungen („Unbekannte Apps installieren“): Installation nachholen
        if (installPending && UpdateProvider.file(this).exists() && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) { installPending = false; installUpdate(); }
    }

    private void js(final String code) { runOnUiThread(new Runnable() { public void run() { if (web != null) web.evaluateJavascript(code, null); } }); }
    private void updEvent(String ev, String val) { js("window.stubenUpdate&&stubenUpdate(" + org.json.JSONObject.quote(ev) + "," + org.json.JSONObject.quote(val) + ")"); }

    /** Lädt die APK in den Cache und öffnet danach den Paket-Installer. */
    private void downloadUpdate(final String url) {
        if (updating) return; updating = true;
        new Thread(new Runnable() { public void run() {
            File f = UpdateProvider.file(MainActivity.this);
            try {
                if (!url.startsWith("https://github.com/") && !url.startsWith("https://objects.githubusercontent.com/")) throw new Exception("Unerwartete Download-Adresse");
                f.getParentFile().mkdirs(); if (f.exists()) f.delete();
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true); c.setConnectTimeout(15000); c.setReadTimeout(30000);
                int code = c.getResponseCode();
                if (code != 200) throw new Exception("Server antwortet mit " + code);
                long total = c.getContentLength(); long got = 0; int lastPct = -1;
                InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(f);
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); got += n; int pct = total > 0 ? (int) (got * 100 / total) : -1; if (pct != lastPct) { lastPct = pct; updEvent("progress", String.valueOf(pct)); } }
                out.close(); in.close();
                if (got < 100000) throw new Exception("Download unvollständig");
                updEvent("downloaded", String.valueOf(got));
                runOnUiThread(new Runnable() { public void run() { installUpdate(); } });
            } catch (Exception e) { if (f.exists()) f.delete(); updEvent("error", String.valueOf(e.getMessage())); }
            finally { updating = false; }
        } }).start();
    }

    private void installUpdate() {
        try {
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                installPending = true; updEvent("needperm", "");
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                return;
            }
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(UpdateProvider.uri(), "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i); updEvent("installing", "");
        } catch (Exception e) { updEvent("error", String.valueOf(e.getMessage())); }
    }

    @Override
    public void onBackPressed() {
        // Nicht beenden, sonst stirbt der Tisch – nur in den Hintergrund.
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        try { stopService(new Intent(this, KeepAliveService.class)); } catch (Exception ignored) {}
        stopServer();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private synchronized void startServer() {
        if (server != null) return;
        final LocalServer srv = new LocalServer(this, web);
        server = srv;
        new Thread(new Runnable() { public void run() {
            try { srv.start(); } catch (Exception e) { synchronized (MainActivity.this) { if (server == srv) server = null; } }
        } }).start();
    }

    private synchronized void stopServer() {
        if (server == null) return;
        final LocalServer srv = server; server = null;
        new Thread(new Runnable() { public void run() { srv.stop(); } }).start();
    }

    /** Was die JS-Engine im WebView aufrufen darf. */
    class Bridge {
        @JavascriptInterface public void respond(String id, int status, String body) { LocalServer s = server; if (s != null) s.respond(id, status, body); }
        @JavascriptInterface public void push(String id, String data) { LocalServer s = server; if (s != null) s.push(id, data); }
        @JavascriptInterface public void closeStream(String id) { LocalServer s = server; if (s != null) s.closeStream(id); }
        @JavascriptInterface public String urls() { LocalServer s = server; return new JSONArray(LocalServer.urls(s != null && s.port > 0 ? s.port : LocalServer.DEFAULT_PORT)).toString(); }
        @JavascriptInterface public int port() { LocalServer s = server; return s != null ? s.port : 0; }
        /** mode: "lan" = WLAN-Server starten + Dienst, "online" = nur Dienst (Relay-Gastgeber), "none" = alles zu. */
        @JavascriptInterface public void hosting(final String mode) {
            runOnUiThread(new Runnable() { public void run() {
                boolean lan = "lan".equals(mode), host = lan || "online".equals(mode);
                if (lan) startServer(); else stopServer();
                try {
                    Intent svc = new Intent(MainActivity.this, KeepAliveService.class);
                    if (host) { if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc); }
                    else stopService(svc);
                } catch (Exception ignored) {}
            } });
        }
        @JavascriptInterface public boolean isPublic() { return server != null; }
        @JavascriptInterface public boolean canUpdate() { return true; }
        @JavascriptInterface public void update(final String url) { downloadUpdate(url); }
        @JavascriptInterface public void installAgain() { runOnUiThread(new Runnable() { public void run() { if (UpdateProvider.file(MainActivity.this).exists()) installUpdate(); } }); }
    }
}
