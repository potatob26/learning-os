package com.learningos.app.widgets;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.widget.RemoteViews;

import com.learningos.app.R;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 小组件二：鼓励语。
 *
 * 语句库由 Web 侧一并推过来（内置 322 句 + 用户自定义，按用户设置混合），
 * 点一下换下一条**在这里本地完成**，不需要开 App。
 *
 * 注意：语句是用户可见的文案，所以这里只负责原样显示，
 * **不做任何拼接、不加感叹号**（项目铁律：鼓励语不说教、不喊口号、不用感叹号）。
 */
public class QuoteWidgetProvider extends BaseWidgetProvider {

    private static JSONArray quotes(Context ctx) {
        JSONArray a = WidgetStore.payload(ctx).optJSONArray("quotes");
        return a == null ? new JSONArray() : a;
    }

    @Override
    protected int itemCount(Context ctx) {
        return quotes(ctx).length();
    }

    @Override
    protected void render(Context ctx, AppWidgetManager mgr, int id) {
        mgr.updateAppWidget(id, build(ctx, id));
    }

    /** 真机路径：尺寸从系统查 */
    public static RemoteViews build(Context ctx, int id) {
        int[] size = WidgetStore.sizeOf(ctx, id);
        return build(ctx, id, size[0], size[1]);
    }

    /** 只构造 RemoteViews，不查系统、不提交（尺寸由调用方给，便于预览与测试） */
    public static RemoteViews build(Context ctx, int id, int widthDp, int heightDp) {
        JSONObject pal = WidgetStore.palette(ctx, id);
        int cText = WidgetRender.color(pal, "text", 0xFF101828);
        int cSub = WidgetRender.color(pal, "secondary", 0xFF5A6270);
        int cBg = WidgetRender.color(pal, "bg", 0xFFF6F7F9);
        int cAccent = WidgetRender.color(pal, "accent", 0xFF3F7DF6);

        int tier = WidgetRender.sizeTier(widthDp, heightDp);

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_quote);
        WidgetRender.tint(v, R.id.w_bg, cBg);
        WidgetRender.tint(v, R.id.w_quote_mark, cAccent);

        JSONArray list = quotes(ctx);
        String quote;
        String hint;
        if (list.length() == 0) {
            // 还没同步过（用户刚放上小组件、或还没打开过 App）
            quote = "打开学习 OS 同步一次";
            hint = "";
        } else {
            int idx = WidgetStore.indexOf(ctx, id) % list.length();
            quote = list.optString(idx, "");
            // 大档才提示「点一下换一句」；小档不占地方
            hint = tier >= 2 ? "点一下换一句" : "";
        }

        WidgetRender.text(v, R.id.w_main, quote, cText);
        WidgetRender.textSize(v, R.id.w_main, tier == 0 ? 12f : tier == 1 ? 14f : 16f);
        WidgetRender.text(v, R.id.w_sub, hint, cSub);
        WidgetRender.show(v, R.id.w_sub, !hint.isEmpty());
        WidgetRender.show(v, R.id.w_quote_mark, tier >= 1);

        // 身体区域点一下换下一条；角上的主题按钮换主题
        WidgetRender.setClick(v, R.id.w_root, ctx, QuoteWidgetProvider.class, id, WidgetRender.ACTION_NEXT);
        WidgetRender.setClick(v, R.id.w_theme, ctx, QuoteWidgetProvider.class, id, WidgetRender.ACTION_THEME);
        WidgetRender.tint(v, R.id.w_theme_dot, cAccent);

        return v;
    }
}
