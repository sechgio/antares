import type { SVGProps } from 'react';
import { Eye } from 'lucide-react';

export { Eye };

type IconProps = SVGProps<SVGSVGElement> & {
  size?: string | number;
};

export function EyeSlash({
  size = 24,
  className,
  strokeWidth = 2,
  ...props
}: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      data-testid="canvas-eye-slash"
      {...props}
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function VisibilityIcon({
  visible,
  className,
  ...props
}: IconProps & { visible: boolean }) {
  if (visible) {
    return <Eye className={className} {...props} />;
  }
  return <EyeSlash className={className} {...props} />;
}
