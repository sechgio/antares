import React, { forwardRef } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  children,
  ...props
}, ref) {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-5 py-2 text-sm',
    lg: 'px-7 py-3 text-base',
  };

  const variants = {
    primary: 'text-[var(--text-on-accent)] font-medium bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:bg-[var(--bg-input)]',
    secondary: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]',
    ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]',
    danger: 'bg-transparent text-[var(--accent-red)] border border-[var(--accent-red)] hover:bg-[var(--bg-elevated)]',
  };

  return (
    <button
      ref={ref}
      data-slot="button"
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-full transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] ${sizeClasses[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
