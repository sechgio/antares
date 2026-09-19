import { useRef, useState } from "react";
import { CheckCircle, ChevronDown } from "lucide-react";
import Button from "@/components/ui/Button";

interface StepProps {
  number: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  status?: "pending" | "done";
}

export default function Step({
  number,
  title,
  icon,
  children,
  disabled,
  badge,
  defaultOpen = true,
  status = "pending",
}: StepProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const done = status === "done";

  return (
    <div
      className={`rounded-lg border transition-colors ${isOpen ? "border-[var(--border-medium)] bg-[var(--bg-elevated)]" : "border-[var(--border-subtle)] bg-transparent hover:border-[var(--border-medium)]"} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
    >
      <Button
        variant="none"
        size="none"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-2 py-2 group cursor-pointer select-none rounded-lg"
      >
        <span
          className={`inline-flex h-[20px] w-[20px] items-center justify-center rounded-full text-[10px] font-bold shrink-0 transition-colors ${done ? "bg-[var(--accent-green)] text-[var(--text-on-accent)]" : isOpen ? "bg-[var(--accent-primary)] text-[var(--text-on-accent)]" : "bg-[color:color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)] ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--accent-primary)_30%,transparent)]"}`}
        >
          {done ? <CheckCircle size={12} /> : number}
        </span>
        <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate">
          {title}
        </span>
        <span className="text-[var(--text-muted)] shrink-0">{icon}</span>
        {badge && <span className="ml-auto mr-1">{badge}</span>}
        <ChevronDown
          size={12}
          className={`ml-auto text-[var(--text-muted)] transition-transform duration-200 shrink-0 ${isOpen ? "rotate-0" : "-rotate-90"}`}
        />
      </Button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{
          maxHeight: isOpen
            ? `${contentRef.current?.scrollHeight ?? 800}px`
            : "0px",
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div className="px-2 pb-2 pt-0.5">{children}</div>
      </div>
    </div>
  );
}
