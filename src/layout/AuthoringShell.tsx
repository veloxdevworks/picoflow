import type { ReactNode } from "react";
import { Cpu, GanttChart, Monitor, PanelRight } from "lucide-react";
import { PhotoStrip } from "../features/photos/PhotoStrip";
import { ProjectMenu } from "../features/project/ProjectMenu";
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
  const playheadMs = useEditor((s) => s.playheadMs);

  const title = project?.name ?? "No project";
  const inspectorHint = selection
    ? `${selection.type} ${selection.id}`
    : "Select a photo, clip, or action.";

  return (
    <div className="grid h-full grid-cols-[13.5rem_minmax(0,1fr)_15rem] grid-rows-[auto_minmax(0,1fr)_10.5rem] bg-zinc-950 text-zinc-100">
      <header className="col-span-3 flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-medium tracking-tight text-zinc-200">
            <Cpu className="h-4 w-4 text-zinc-400" aria-hidden />
            PicoFlow
          </span>
          <ProjectMenu />
        </div>
        <p className="truncate text-xs text-zinc-400">
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
        <Well
          icon={<Monitor className="h-6 w-6" aria-hidden />}
          label={project ? "No warped frame" : "No project open"}
          hint={
            project
              ? "Imported photos will appear here after normalize."
              : "File → New or Open to create a .picoflow project."
          }
        />
      </section>

      <aside className="min-h-0 border-l border-zinc-800 bg-zinc-950">
        <Well
          icon={<PanelRight className="h-5 w-5" aria-hidden />}
          label="Inspector"
          hint={inspectorHint}
        />
      </aside>

      <section className="col-span-3 min-h-0 border-t border-zinc-800 bg-zinc-900/40">
        <Well
          icon={<GanttChart className="h-5 w-5" aria-hidden />}
          label="Timeline"
          hint={
            project
              ? `Playhead ${playheadMs} ms · two tracks: clips and keyframes.`
              : "Clips and keyframes will sit on two tracks here."
          }
        />
      </section>
    </div>
  );
}
