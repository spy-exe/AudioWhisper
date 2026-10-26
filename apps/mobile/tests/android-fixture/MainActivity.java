package studio.audiowhisper.qaaudio;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Emulator-only fixture. Plays the repository's public speech.wav, never the host microphone. */
public class MainActivity extends Activity {
  private MediaPlayer player;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setPadding(40, 80, 40, 40);
    TextView label = new TextView(this);
    label.setText("AudioWhisper QA: synthetic audio from repository fixture");
    label.setTextSize(22);
    layout.addView(label);
    Button play = new Button(this);
    play.setText("Play synthetic speech");
    play.setOnClickListener(view -> play());
    layout.addView(play);
    Button stop = new Button(this);
    stop.setText("Stop synthetic speech");
    stop.setOnClickListener(view -> { if (player != null) { player.release(); player = null; } });
    layout.addView(stop);
    setContentView(layout);
  }
  private void play() {
    try {
      if (player != null) player.release();
      player = new MediaPlayer();
      player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_ALL).build());
      try (android.content.res.AssetFileDescriptor audio = getAssets().openFd("speech.wav")) {
        player.setDataSource(audio.getFileDescriptor(), audio.getStartOffset(), audio.getLength());
      }
      player.setLooping(true);
      player.prepare();
      player.start();
    } catch (Exception error) { throw new IllegalStateException("Synthetic fixture could not play", error); }
  }
  @Override public void onDestroy() { if (player != null) player.release(); super.onDestroy(); }
}
