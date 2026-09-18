import { Trash2 } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CampoPanelListItem } from '../types';
import Button from '@/components/ui/Button';

interface PanelListProps {
    panels: CampoPanelListItem[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
}

export default function PanelList({ panels, selectedId, onSelect, onDelete }: PanelListProps) {
    return (
        <div className="rcampo-panel-list">
            <div className="rcampo-panel-list-header">
                <span className="rcampo-panel-list-title">Paneles</span>
                <span className="rcampo-panel-list-count">{panels.length}</span>
            </div>

            <div className="rcampo-panel-list-items">
                {panels.map((panel, index) => (
                    <div
                        key={panel.id}
                        className={`rcampo-panel-item ${selectedId === panel.id ? 'active' : ''}`}
                    >
                        <Button variant="none" size="none"
                            className="rcampo-panel-item-main"
                            onClick={() => onSelect(panel.id)}
                        >
                            <span className="rcampo-panel-item-index">#{index + 1}</span>
                            <span className="rcampo-panel-item-label">{panel.label}</span>
                            <span className="rcampo-panel-item-meta">
                                {panel.photoCount} foto{panel.photoCount !== 1 ? 's' : ''}
                                {panel.pageCount > 0 ? ` · ${panel.pageCount} hoja${panel.pageCount !== 1 ? 's' : ''}` : ''}
                            </span>
                        </Button>
                        <WithHoverTooltip label="Eliminar panel" placement="bottom">
                            <Button variant="none" size="none"
                                className="rcampo-panel-item-delete"
                                onClick={() => onDelete(panel.id)}
                                aria-label="Eliminar panel"
                            >
                                <Trash2 size={12} />
                            </Button>
                        </WithHoverTooltip>
                    </div>
                ))}
            </div>
        </div>
    );
}
