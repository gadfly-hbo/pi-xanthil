import { useState } from "react";
import { Trash2 } from "lucide-react";

interface Props {
  title: string;
  /** Label for the "also delete documents" checkbox, e.g. 同时删除该会话的文档. */
  fileToggleLabel: string;
  onCancel: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}

/**
 * Delete confirmation with an opt-in "also move documents to Trash" checkbox.
 * Mount it only while a delete is pending (presence = open) so the checkbox
 * resets to off each time. Documents = the app-managed task/workspace folder;
 * externally-registered paths are never touched (enforced server-side).
 */
export function ConfirmDeleteDialog({ title, fileToggleLabel, onCancel, onConfirm }: Props) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="w-[400px] rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>

        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-800/50">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-red-600"
          />
          <span className="text-[12.5px] text-neutral-700 dark:text-neutral-300">
            {fileToggleLabel}
            <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-neutral-400">
              文档将移到废纸篓（可恢复）；外部登记的文件夹（如 Downloads）不受影响。
            </span>
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="inline-flex h-8 items-center rounded-md border border-neutral-200 bg-white px-3 text-[12.5px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(deleteFiles)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-3 text-[12.5px] font-medium text-white hover:bg-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            {deleteFiles ? "删除并移文档到废纸篓" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
