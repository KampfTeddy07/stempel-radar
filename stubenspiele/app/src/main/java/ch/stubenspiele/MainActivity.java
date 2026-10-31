package ch.stubenspiele;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
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
import java.io.InputStream;
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
    private volatile String pendingInvite; // Einladungslink, den Android an die App übergeben hat

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
        pendingInvite = inviteFrom(getIntent());
        setContentView(web);
        web.loadUrl("http://" + APP_HOST + "/");
    }


    private static String inviteFrom(Intent i) {
        if (i == null || i.getData() == null) return null;
        String u = i.getData().toString();
        return u.contains("join=") ? u : null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        final String u = inviteFrom(intent);
        if (u == null) return;
        pendingInvite = u;
        runOnUiThread(new Runnable() { public void run() { if (web != null) web.evaluateJavascript("window.stubenInvite&&stubenInvite(" + org.json.JSONObject.quote(u) + ")", null); } });
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
        /** Statusleiste, Navigationsleiste und Hintergrund an den gewählten Tischfilz anpassen. */
        @JavascriptInterface public void setBars(final String hex) {
            runOnUiThread(new Runnable() { public void run() {
                try { int c = android.graphics.Color.parseColor(hex); getWindow().setStatusBarColor(c); getWindow().setNavigationBarColor(c); if (web != null) web.setBackgroundColor(c); } catch (Exception ignored) {}
            } });
        }
        /** Liefert eine wartende Einladung (einmalig) – aus QR-Scan oder angetipptem Link. */
        @JavascriptInterface public String invite() { String u = pendingInvite; pendingInvite = null; return u == null ? "" : u; }
        /** Öffnet eine Adresse im System-Browser (z. B. den Download einer neuen Version). */
        @JavascriptInterface public void openUrl(final String url) {
            if (!url.startsWith("https://github.com/KampfTeddy07/") && !url.startsWith("https://kampfteddy07.github.io/")) return;
            runOnUiThread(new Runnable() { public void run() { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {} } });
        }
    }
}
