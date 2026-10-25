package ch.stubenspiele;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import org.json.JSONArray;

public class MainActivity extends Activity {
    private WebView web;
    private LocalServer server;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        try {
            Intent svc = new Intent(this, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);
        } catch (Exception ignored) {}
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient());
        web.setBackgroundColor(0xFF153527);
        web.addJavascriptInterface(new Bridge(), "Bridge");
        server = new LocalServer(this, web);
        try {
            // Netzwerk nicht auf dem UI-Thread: Server in eigenem Thread binden, kurz warten.
            final Exception[] err = new Exception[1];
            Thread t = new Thread(new Runnable() { public void run() { try { server.start(); } catch (Exception e) { err[0] = e; } } });
            t.start(); t.join(5000);
            if (err[0] != null) throw err[0];
            if (server.port == 0) throw new Exception("Zeitüberschreitung beim Starten");
            setContentView(web);
            web.loadUrl("http://127.0.0.1:" + server.port + "/");
        } catch (Exception e) {
            TextView tv = new TextView(this);
            tv.setPadding(48, 96, 48, 48);
            tv.setText("Der Server konnte nicht starten:\n" + e.getMessage());
            setContentView(tv);
        }
    }

    @Override
    public void onBackPressed() {
        // Nicht beenden, sonst stirbt der Tisch – nur in den Hintergrund.
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        try { stopService(new Intent(this, KeepAliveService.class)); } catch (Exception ignored) {}
        if (server != null) server.stop();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Was die JS-Engine im WebView aufrufen darf. */
    class Bridge {
        @JavascriptInterface public void respond(String id, int status, String body) { server.respond(id, status, body); }
        @JavascriptInterface public void push(String id, String data) { server.push(id, data); }
        @JavascriptInterface public void closeStream(String id) { server.closeStream(id); }
        @JavascriptInterface public String urls() { return new JSONArray(server.urls()).toString(); }
        @JavascriptInterface public int port() { return server.port; }
    }
}
