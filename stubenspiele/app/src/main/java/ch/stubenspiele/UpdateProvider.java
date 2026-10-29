package ch.stubenspiele;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/** Reicht die heruntergeladene Update-APK an den Paket-Installer weiter (nur diese eine Datei, nur lesend). */
public class UpdateProvider extends ContentProvider {
    public static final String AUTHORITY = "ch.stubenspiele.update";
    public static final String FILE = "Stubenspiele.apk";

    public static File file(android.content.Context ctx) { return new File(new File(ctx.getCacheDir(), "update"), FILE); }
    public static Uri uri() { return Uri.parse("content://" + AUTHORITY + "/" + FILE); }

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!FILE.equals(uri.getLastPathSegment()) || !"r".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(file(getContext()), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public String getType(Uri uri) { return "application/vnd.android.package-archive"; }
    @Override public Cursor query(Uri uri, String[] p, String s, String[] a, String o) { return null; }
    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
