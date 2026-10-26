package studio.audiowhisper.qaprobe;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.Bundle;
import android.util.Base64;
import android.util.Xml;
import android.view.accessibility.AccessibilityNodeInfo;
import org.xmlpull.v1.XmlSerializer;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;

/** Reads the current hierarchy without waiting for a live recording clock to become idle. */
public final class DumpRunner extends Instrumentation {
  @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      UiAutomation automation = getUiAutomation();
      AccessibilityNodeInfo root = automation.getRootInActiveWindow();
      for (int attempt = 0; root == null && attempt < 20; attempt++) {
        android.os.SystemClock.sleep(100);
        root = automation.getRootInActiveWindow();
      }
      if (root == null) throw new IllegalStateException("No active window");
      root.refresh();
      StringWriter text = new StringWriter();
      XmlSerializer xml = Xml.newSerializer();
      xml.setOutput(text);
      xml.startTag(null, "hierarchy");
      append(xml, root, 0);
      xml.endTag(null, "hierarchy");
      xml.flush();
      result.putString("tree", Base64.encodeToString(text.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
      finish(Activity.RESULT_OK, result);
    } catch (Exception error) {
      result.putString("error", error.toString());
      finish(Activity.RESULT_CANCELED, result);
    }
  }
  private void append(XmlSerializer xml, AccessibilityNodeInfo node, int depth) throws Exception {
    if (depth > 80) return;
    xml.startTag(null, "node");
    xml.attribute(null, "text", string(node.getText()));
    xml.attribute(null, "content-desc", string(node.getContentDescription()));
    xml.attribute(null, "class", string(node.getClassName()));
    xml.attribute(null, "package", string(node.getPackageName()));
    Rect bounds = new Rect(); node.getBoundsInScreen(bounds);
    xml.attribute(null, "bounds", "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]");
    xml.attribute(null, "enabled", String.valueOf(node.isEnabled()));
    xml.attribute(null, "focused", String.valueOf(node.isFocused()));
    for (int index = 0; index < node.getChildCount(); index++) {
      AccessibilityNodeInfo child = node.getChild(index);
      if (child != null) append(xml, child, depth + 1);
    }
    xml.endTag(null, "node");
  }
  private String string(CharSequence value) { return value == null ? "" : value.toString(); }
}
