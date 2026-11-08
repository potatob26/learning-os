package com.learningos.app.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

import com.learningos.app.R;

import org.json.JSONArray;

/**
 * 三个小组件的公共逻辑：更新、尺寸变化、删除清理、以及两个点击广播。
 *
 * 点击走广播而不是启动 Activity，所以「换下一条 / 换主题」毫秒级完成，
 * 不需要打开 App，也不需要 WebView（详见 {@link WidgetRender#setClick}）。
 */
public abstract class BaseWidgetProvider extends AppWidgetProvider {

    /** 这个实例一共有多少条可轮换的内容（语句 / 重要日期）。0 表示没有，点击时不动 */
    protected abstract int itemCount(Context ctx);

    /** 画一个实例 */
    protected abstract void render(Context ctx, AppWidgetManager mgr, int appWidgetId);

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            try {
                render(ctx, mgr, id);
            } catch (Throwable t) {
                // 小组件在 launcher 进程里跑，抛出去会让那块变成空白/「加载中」
                renderFallback(ctx, mgr, id);
            }
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, android.os.Bundle newOptions) {
        // 用户把小组件拉大拉小了：按新尺寸重画（这就是「调整比例」）
        try {
            render(ctx, mgr, id);
        } catch (Throwable t) {
            renderFallback(ctx, mgr, id);
        }
    }

    @Override
    public void onDeleted(Context ctx, int[] appWidgetIds) {
        // 实例被删掉了，把它那两个私有键清掉，免得 SharedPreferences 里堆垃圾
        for (int id : appWidgetIds) {
            WidgetStore.prefs(ctx).edit()
                    .remove("w" + id + "_theme")
                    .remove("w" + id + "_index")
                    .apply();
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String action = intent.getAction();
        if (action == null) return;
        int id = intent.getIntExtra(WidgetRender.EXTRA_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return;

        boolean changed = false;
        if (WidgetRender.ACTION_NEXT.equals(action)) {
            int n = 0;
            try {
                n = itemCount(ctx);
            } catch (Throwable ignored) {
                /* 没有内容就当作 0 */
            }
            if (n > 0) {
                // 取模，点到最后一条回到第一条
                WidgetStore.setIndex(ctx, id, (WidgetStore.indexOf(ctx, id) + 1) % n);
                changed = true;
            }
        } else if (WidgetRender.ACTION_THEME.equals(action)) {
            JSONArray order = WidgetStore.themeOrder(ctx);
            if (order.length() > 0) {
                String cur = WidgetStore.themeOf(ctx, id);
                int at = -1;
                for (int i = 0; i < order.length(); i++) {
                    if (order.optString(i).equals(cur)) { at = i; break; }
                }
                // 当前主题不在表里（首次、或主题被删）→ 从第一套开始
                WidgetStore.setTheme(ctx, id, order.optString((at + 1) % order.length()));
                changed = true;
            }
        }

        if (changed) {
            try {
                render(ctx, AppWidgetManager.getInstance(ctx), id);
            } catch (Throwable t) {
                renderFallback(ctx, AppWidgetManager.getInstance(ctx), id);
            }
        }
    }

    /** 任何异常时的兜底：画一块干净的底色，至少不是空白或「加载中」 */
    protected void renderFallback(Context ctx, AppWidgetManager mgr, int id) {
        try {
            android.widget.RemoteViews v = new android.widget.RemoteViews(ctx.getPackageName(), R.layout.widget_percent);
            WidgetRender.tint(v, R.id.w_bg, 0xFFF2F4F8);
            WidgetRender.text(v, R.id.w_title, "学习 OS", 0xFF5A6270);
            WidgetRender.text(v, R.id.w_main, "打开应用", 0xFF101828);
            WidgetRender.text(v, R.id.w_sub, "", 0xFF5A6270);
            mgr.updateAppWidget(id, v);
        } catch (Throwable ignored) {
            /* 连兜底都失败就只能放弃，不能再抛 */
        }
    }
}
