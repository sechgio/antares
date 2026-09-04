import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HeaderForm from './HeaderForm';
import { REPORT_TYPES } from '../constants';

describe('HeaderForm in reportes-campo', () => {
    const config = REPORT_TYPES[0]; // panel-fotografico

    it('renders custom DatePicker for Fecha de Trabajo and triggers onFieldChange', () => {
        const onFieldChange = vi.fn();
        const header = {
            titulo: 'Panel Fotográfico',
            CENTRO: 'San Juan',
            FECHA_TRABAJO: '2026-08-28',
            ESTADO: 'Activo',
        };

        render(
            <HeaderForm
                config={config}
                fields={config.fields}
                header={header}
                onFieldChange={onFieldChange}
                logoLeft={null}
                logoRight={null}
                onLogoChange={vi.fn()}
                onLogoRemove={vi.fn()}
            />,
        );

        const datePickerTrigger = screen.getByRole('button', { name: 'Fecha de Trabajo' });
        expect(datePickerTrigger).toBeInTheDocument();
        expect(datePickerTrigger).toHaveTextContent('28/08/2026');

        fireEvent.click(datePickerTrigger);
        expect(screen.getByRole('dialog', { name: 'Fecha de Trabajo' })).toBeInTheDocument();
        expect(screen.getByText('Hoy')).toBeInTheDocument();
        expect(screen.getByText('Borrar')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Hoy'));
        expect(onFieldChange).toHaveBeenCalledWith(
            'FECHA_TRABAJO',
            expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        );
    });

    it('clears date field when Borrar is clicked', () => {
        const onFieldChange = vi.fn();
        const header = {
            titulo: 'Panel Fotográfico',
            FECHA_TRABAJO: '2026-08-28',
        };

        render(
            <HeaderForm
                config={config}
                fields={config.fields}
                header={header}
                onFieldChange={onFieldChange}
                logoLeft={null}
                logoRight={null}
                onLogoChange={vi.fn()}
                onLogoRemove={vi.fn()}
            />,
        );

        const datePickerTrigger = screen.getByRole('button', { name: 'Fecha de Trabajo' });
        fireEvent.click(datePickerTrigger);
        fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

        expect(onFieldChange).toHaveBeenCalledWith('FECHA_TRABAJO', '');
    });
});
