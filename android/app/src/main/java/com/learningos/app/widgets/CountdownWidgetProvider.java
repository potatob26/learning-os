package com.learningos.app.widgets;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.widget.RemoteViews;

import com.learningos.app.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * 小组件三：距离重要日期还有多久。
 *
 * 「还有几天」是**在这里本地算**的，不是 Web 侧算好推过来的 ——
 * 这一点很重要：跨天之后即使一整天没打开 App，桌面上的天数也是对的。
 * 真正会过期的只有「今日百分比」那一个（它需要当天的学习记录）。
 *
 * 点一下换下一个重要日期；角上的按钮换主题；拉大拉小按尺寸换字号与信息密度
 * （「调整比例 = 小组件尺寸」就是这么落地的）。
 */
public class CountdownWidgetProvider extends BaseWidgetProvider {

    private static JSONArray dates(Context ctx) {
        JSONArray a = WidgetStore.payload(ctx).optJSONArray("dates");
        return a == null ? new JSONArray() : a;
    }

    @Override
    protected int itemCount(Context ctx) {
        return dates(ctx).length();
    }

    /** 目标日到今天的整日差；数据不合法时返回 null，让界面退回「未设置」而不是显示 0 */
    private static Integer daysUntil(String yyyyMMdd) {
        if (yyyyMMdd == null || yyyyMMdd.length() < 10) return null;
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setTimeZone(TimeZone.getDefault());
        try {
            Date target = f.parse(yyyyMMdd.substring(0, 10));
            if (target == null) return null;
            Calendar a = Calendar.getInstance();
            Calendar b = Calendar.getInstance();
            b.setTime(target);
            // 只比「自然日」，所以把两边都归到当天零点再相减 ——
            // 否则同一天下午和晚上会算出不同的天数
            a.set(Calendar.HOUR_OF_DAY, 0); a.set(Calendar.MINUTE, 0);
            a.set(Calendar.SECOND, 0); a.set(Calendar.MILLISECOND, 0);
            b.set(Calendar.HOUR_OF_DAY, 0); b.set(Calendar.MINUTE, 0);
            b.set(Calendar.SECOND, 0); b.set(Calendar.MILLISECOND, 0);
            long diff = b.getTimeInMillis() - a.getTimeInMillis();
            return (int) Math.round(diff / 86400000.0);
        } catch (ParseException e) {
            return null;
        }
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

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_countdown);
        WidgetRender.tint(v, R.id.w_bg, cBg);
        WidgetRender.tint(v, R.id.w_theme_dot, cAccent);
        WidgetRender.tint(v, R.id.w_rule, cAccent);

        JSONArray list = dates(ctx);
        String title;
        String main;
        String sub;
        if (list.length() == 0) {
            title = "重要日期";
            main = "—";
            sub = "打开应用添加";
        } else {
            JSONObject d = list.optJSONObject(WidgetStore.indexOf(ctx, id) % list.length());
            if (d == null) d = new JSONObject();
            title = "距离 " + d.optString("title", "重要日期");
            Integer days = daysUntil(d.optString("date", ""));
            if (days == null) {
                main = "—";
                sub = "";
            } else if (days == 0) {
                main = "今天";
                sub = d.optString("date", "");
            } else if (days > 0) {
                main = days + " 天";
                sub = d.optString("date", "");
            } else {
                main = (-days) + " 天前";
                sub = d.optString("date", "");
            }
        }

        WidgetRender.text(v, R.id.w_title, title, cSub);
        WidgetRender.textSize(v, R.id.w_title, tier == 0 ? 9f : 11f);
        WidgetRender.text(v, R.id.w_main, main, cText);
        // 主数字按尺寸分档 —— 这是「比例」最直观的体现：小档只留数字，大档数字很醒目
        WidgetRender.textSize(v, R.id.w_main, tier == 0 ? 24f : tier == 1 ? 36f : 52f);
        WidgetRender.text(v, R.id.w_sub, sub, cSub);
        WidgetRender.textSize(v, R.id.w_sub, tier == 0 ? 9f : 10f);
        WidgetRender.show(v, R.id.w_sub, tier >= 2 && !sub.isEmpty());
        WidgetRender.show(v, R.id.w_rule, tier >= 1);

        // 有多个重要日期时才有意义点着换；只有一个也不会出错（取模后还是它自己）
        WidgetRender.setClick(v, R.id.w_root, ctx, CountdownWidgetProvider.class, id, WidgetRender.ACTION_NEXT);
        WidgetRender.setClick(v, R.id.w_theme, ctx, CountdownWidgetProvider.class, id, WidgetRender.ACTION_THEME);

        return v;
    }
}
