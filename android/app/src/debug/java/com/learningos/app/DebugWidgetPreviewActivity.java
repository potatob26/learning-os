package com.learningos.app;

import android.app.Activity;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.RemoteViews;
import android.widget.ScrollView;
import android.widget.TextView;

import com.learningos.app.widgets.CountdownWidgetProvider;
import com.learningos.app.widgets.PercentWidgetProvider;
import com.learningos.app.widgets.QuoteWidgetProvider;
import com.learningos.app.widgets.WidgetRender;
import com.learningos.app.widgets.WidgetStore;

/**
 * 只存在于 debug 构建的「小组件预览页」。
 *
 * 为什么需要它：桌面小组件必须由用户在 launcher 上手动拖放才能绑定，
 * 而 launcher 的长按拖拽**无法用 adb 可靠驱动**（swipe、单次 shell 内完整的
 * motionevent DOWN→MOVE→UP 都试过，系统始终 0 个已绑定实例）。
 * 系统「添加小组件」选择器里显示的又是静态 previewLayout —— 只 inflate 布局 XML、
 * 不跑 provider，**按设计就不着色**，所以它证明不了上色对不对。
 *
 * 这个页面用与他人完全相同的那套 build() 把 RemoteViews **真 inflate 出来**，
 * 于是能看到：底色 / 文字色 / 强调色 / 圆角 / 进度条 / 按尺寸分档的字号。
 *
 * 它已经抓到过两个真问题（都是静态预览看不出来的）：
 *   ① 给 FrameLayout 调 setImageTintList → RemoteViews ActionException
 *      → provider 的 try/catch 兜住 → 整块小组件静默变兜底样式
 *   ② 尺寸分档用「高 AND 宽」判定 → 4×1 宽而矮的被误判成大档，一行高的格子里塞进两行字
 *
 * 放在 src/debug/ 下，**不会进正式包**。
 */
public class DebugWidgetPreviewActivity extends Activity {

    /** 主题对照：一深一浅，足以看出配色有没有真的生效 */
    private static final String[][] THEMES = {
        { "liquid-glass-wc", "液态玻璃（深）" },
        { "pure-light", "极简白（浅）" },
    };

    /** 尺寸对照：验「调整比例」（小 / 中 / 大） */
    private static final int[][] SIZES = {
        { 110, 60 },    // 小：一行高
        { 300, 90 },    // 中：2×1 常见
        { 300, 200 },   // 大：2×2 及以上
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF20242B);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);

        int fakeId = -100;

        // ── 主题对照：三个小组件各两套主题 ──
        addTitle(root, "主题对照（每个小组件可单独选主题）");
        for (String[] theme : THEMES) {
            for (String which : new String[] { "percent", "quote", "countdown" }) {
                addSection(root, which + " · " + theme[1]);
                addViews(root, buildBy(which, ++fakeId, theme[0], 300, 90), 300, 90);
            }
        }

        // ── 尺寸对照：同一个小组件在三种尺寸下 ──
        addTitle(root, "尺寸对照（拉大拉小 = 调整比例）");
        for (int[] size : SIZES) {
            addSection(root, "重要日期倒计时 · " + size[0] + "×" + size[1] + "dp");
            addViews(root, buildBy("countdown", ++fakeId, "immersive", size[0], size[1]), size[0], size[1]);
        }

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);

        // 假 id 只用于预览，用完清掉，别在真存档里留垃圾
        for (int id = -300; id < 0; id++) {
            WidgetStore.prefs(this)
                .edit()
                .remove("w" + id + "_theme")
                .remove("w" + id + "_index")
                .apply();
        }
    }

    /** 按名字构造，避免三处重复；尺寸显式传入，预览页不查系统 */
    private RemoteViews buildBy(String which, int id, String theme, int w, int h) {
        WidgetStore.setTheme(this, id, theme);
        switch (which) {
            case "percent":
                return PercentWidgetProvider.build(this, id, w, h);
            case "quote":
                return QuoteWidgetProvider.build(this, id, w, h);
            default:
                return CountdownWidgetProvider.build(this, id, w, h);
        }
    }

    private void addTitle(LinearLayout root, String title) {
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(0xFF7DD3FC);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setPadding(0, dp(20), 0, dp(2));
        root.addView(t);
    }

    private void addSection(LinearLayout root, String title) {
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(0xFFB9C0CC);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        t.setPadding(0, dp(10), 0, dp(4));
        root.addView(t);
    }

    /** 把 RemoteViews 真正 inflate 成可见 View；同时用同一套 tier 函数把档位打出来核对 */
    private void addViews(LinearLayout root, RemoteViews views, int w, int h) {
        View v = views.apply(this, null);
        // 宽度也按 dp 给，宽而矮的格子才能看出「一行放不下第二行」的真实效果
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(Math.min(w, 340)), dp(h)));
        root.addView(v);

        TextView info = new TextView(this);
        info.setText("layout=" + views.getLayoutId() + " · sizeTier(" + w + "," + h + ")=" + WidgetRender.sizeTier(w, h));
        info.setTextColor(0xFF6B7280);
        info.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        info.setPadding(0, dp(2), 0, 0);
        root.addView(info);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
