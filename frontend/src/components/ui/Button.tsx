import React from 'react';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  onClick,
  disabled = false,
  className = '',
  children,
}: ButtonProps) {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-5 py-2 text-sm',
    lg: 'px-7 py-3 text-base',
  };

  const variants = {
    primary: 'text-[var(--text-on-accent)] font-medium',
    secondary: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]',
    ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]',
    danger: 'bg-transparent text-[var(--accent-red)] border border-[var(--accent-red)] hover:bg-[var(--bg-elevated)]',
  };

  const isPrimary = variant === 'primary';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] ${sizeClasses[size]} ${variants[variant]} ${className}`}
      style={isPrimary ? { backgroundColor: disabled ? 'var(--bg-input)' : 'var(--accent-primary)' } : undefined}
      onMouseEnter={(e) => { if (isPrimary && !disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--accent-primary-hover)'; }}
      onMouseLeave={(e) => { if (isPrimary && !disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--accent-primary)'; }}
    >
      {children}
    </button>
  );
}
