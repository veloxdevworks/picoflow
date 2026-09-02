import { useState, type ReactNode } from "react";
import { Cpu, PanelRight, Usb } from "lucide-react";
import { InstallWizard } from "../features/install/InstallWizard";
import { NormalizeView } from "../features/normalize/NormalizeView";
import { PhotoStrip } from "../features/photos/PhotoStrip";
import { ProjectMenu } from "../features/project/ProjectMenu";
import { Timeline } from "../features/timeline/Timeline";
import { WarpedViewer } from "../features/viewer/WarpedViewer";
import { useEditor } from "../store/editor";

function Well({
  icon,
  label,
  hint,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-zinc-600">{icon}</div>
      <p className="text-sm font-medium text-zinc-400">{label}</p>
      <p className="max-w-sm text-xs leading-relaxed text-zinc-600">{hint}</p>
    </div>
  );
}

export function AuthoringShell() {
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const selection = useEditor((s) => s.selection);
  const [installOpen, setInstallOpen] = useState(false);

  const title = project?.name ?? "No project";
  const inspectorHint = selection
    ? `${selection.type} ${selection.id}`
    : "Select a photo, clip, or action.";

  return (
    <div className="grid h-full grid-cols-[13.5rem_minmax(0,1fr)_15rem] grid-rows-[auto_minmax(0,1fr)_12.5rem] bg-zinc-950 text-zinc-100">
      <header className="col-span-3 flex items-center justify-between gap-3 border-b border-zinc-800 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex shrink-0 items-center gap-2 text-sm font-medium tracking-tight text-zinc-200">
            <Cpu className="h-4 w-4 text-zinc-400" aria-hidden />
            PicoFlow
          </span>
          <ProjectMenu shortcutsEnabled={!installOpen} />
          <button
            type="button"
            onClick={() => setInstallOpen(true)}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
          >
            <Usb className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
            Install
          </button>
        </div>
        <p className="min-w-0 max-w-[40%] truncate text-right text-xs text-zinc-400">
          {title}
          {dirty ? (
            <span className="ml-1.5 text-zinc-500" title="Unsaved changes">
              •
            </span>
          ) : null}
        </p>
      </header>

      <aside className="min-h-0 border-r border-zinc-800">
        <PhotoStrip />
      </aside>

      <section className="min-h-0 bg-zinc-950">
        {selection?.type === "photo" ? <NormalizeView /> : <WarpedViewer />}
      </section>

      <aside className="min-h-0 border-l border-zinc-800 bg-zinc-950">
        <Well
          icon={<PanelRight className="h-5 w-5" aria-hidden />}
          label="Inspector"
          hint={inspectorHint}
        />
      </aside>

      <section className="col-span-3 min-h-0 border-t border-zinc-800 bg-zinc-900/40">
        <Timeline />
      </section>
      {installOpen ? (
        <InstallWizard onClose={() => setInstallOpen(false)} />
      ) : null}
    </div>
  );
}
