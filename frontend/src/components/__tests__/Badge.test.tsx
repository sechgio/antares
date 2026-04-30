import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from '../ui/Badge';

describe('Badge', () => {
  it('renders with text', () => {
    render(<Badge variant="success">Success</Badge>);
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('renders with warning variant', () => {
    render(<Badge variant="warning">Warning</Badge>);
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });
});
