# Android-App

Capacitor-Projekt. Die Web-App aus `../index.html` wird beim Build nach `www/` kopiert (Leaflet lokal gebündelt).
Hintergrund-GPS: `@capacitor-community/background-geolocation` (Vordergrund-Dienst mit Benachrichtigung),
Meldungen: `@capacitor/local-notifications`. Build läuft in GitHub Actions (`.github/workflows/android.yml`),
die fertige APK liegt im Release `android-latest`.
