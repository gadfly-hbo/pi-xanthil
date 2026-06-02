import { X, Eye, EyeOff } from "lucide-react";
import { TABS } from "@/components/MainHeader";
import { getSubTabsForTab } from "@/lib/constants";
import { cn } from "@/lib/cn";

interface Props {
  onClose: () => void;
  hiddenTabs: string[];
  toggleTab: (id: string, isVisible: boolean) => void;
}

export function SettingsModal(p: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 px-5 dark:border-neutral-800">
          <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">界面设置</h2>
          <button
            onClick={p.onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="mb-4 text-[13.5px] font-medium text-neutral-800 dark:text-neutral-200">标签页显示配置</h3>
          <p className="mb-6 text-[12.5px] leading-5 text-neutral-500 dark:text-neutral-400">
            在此处自定义您想要显示或隐藏的功能模块及子视图，精简界面以提升专注度。
          </p>

          <div className="space-y-6">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const tabVisible = !p.hiddenTabs.includes(tab.id);
              const subTabs = getSubTabsForTab(tab.id);

              return (
                <div key={tab.id} className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-4 dark:border-neutral-800 dark:bg-neutral-950/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
                      <span className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">{tab.label}</span>
                    </div>
                    <button
                      onClick={() => p.toggleTab(tab.id, !tabVisible)}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
                        tabVisible
                          ? "bg-neutral-200/60 text-neutral-700 hover:bg-neutral-300/60 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                          : "bg-neutral-200 text-neutral-500 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-600"
                      )}
                    >
                      {tabVisible ? <><Eye className="h-3.5 w-3.5" /> 已显示</> : <><EyeOff className="h-3.5 w-3.5" /> 已隐藏</>}
                    </button>
                  </div>

                  {subTabs.length > 0 && (
                    <div className={cn("mt-4 grid grid-cols-2 gap-3 pl-6", !tabVisible && "opacity-50 grayscale transition-opacity")}>
                      {subTabs.map((sub) => {
                        const subId = `${tab.id}:${sub.id}`;
                        const subVisible = !p.hiddenTabs.includes(subId);
                        return (
                          <div key={sub.id} className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
                            <span className="text-[12.5px] text-neutral-700 dark:text-neutral-300">{sub.label}</span>
                            <button
                              disabled={!tabVisible}
                              onClick={() => p.toggleTab(subId, !subVisible)}
                              className={cn(
                                "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed",
                                subVisible
                                  ? "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                                  : "text-neutral-400 hover:bg-neutral-100 dark:text-neutral-500 dark:hover:bg-neutral-800"
                              )}
                              title={subVisible ? "隐藏" : "显示"}
                            >
                              {subVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
