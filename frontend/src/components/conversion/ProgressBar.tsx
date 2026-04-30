interface ProgressBarProps {
  progress: number;
}

export default function ProgressBar({ progress }: ProgressBarProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-[#222222]">
      <div
        className="h-full bg-[#5E6AD2] transition-all duration-300"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
