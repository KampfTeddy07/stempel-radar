# Stubenspiele – Android-App

Schnauz & Kniffel für bis zu vier Leute. Das Handy mit der App ist der Server, die anderen spielen
im Browser mit (gleiches WLAN oder Hotspot, kein Internet nötig).

**Download:** https://github.com/KampfTeddy07/stempel-radar/releases/tag/stubenspiele-latest

Spiellogik: `app/src/main/assets/engine.js` · Oberfläche: `app/src/main/assets/index.html` ·
HTTP-Server: `app/src/main/java/ch/stubenspiele/LocalServer.java`.
Gebaut wird automatisch per GitHub Actions (`.github/workflows/stubenspiele.yml`).

## Internet-Modus (Hotel-WLAN, Mobilfunk)

Wenn das WLAN die Geräte voneinander trennt (typisch im Hotel), auf der Startseite **Internet** wählen.
Dann läuft alles über einen öffentlichen MQTT-Relay (EMQX, Ersatz: HiveMQ, Mosquitto), die Engine bleibt beim Gastgeber.
Die Mitspieler öffnen https://kampfteddy07.github.io/stempel-radar/spiele und geben den 6-stelligen Code ein.
Der Gastgeber kann auch im Browser hosten (gleiche Seite, „Spiel eröffnen"), muss die Seite aber offen lassen.
