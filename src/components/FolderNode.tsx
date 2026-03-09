import { useEffect, useState, useRef, useContext } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { invoke } from '@tauri-apps/api/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Folder, File, ChevronRight, Loader2, HardDrive, Copy, Scissors, Edit2, Trash2, RefreshCw, ClipboardPaste, XCircle, ExternalLink, FolderOpen } from 'lucide-react';
import { ClipboardContext } from '../App';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { FileNodeInfo, FolderNodeData } from '../types';
import './FolderNode.css';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function FolderNode({ id, data, selected }: NodeProps<any>) {
    const nodeData = data as FolderNodeData;
    const [files, setFiles] = useState<FileNodeInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { clipboardPaths, setClipboardPaths, clipboardMode, setClipboardMode } = useContext(ClipboardContext);

    // Multi-select state
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

    const [menuState, setMenuState] = useState<{
        x: number;
        y: number;
        visible: boolean;
        target: FileNodeInfo | null; // null means empty area (the root node itself)
    }>({ x: 0, y: 0, visible: false, target: null });

    const parentRef = useRef<HTMLDivElement>(null);

    const fetchDir = async () => {
        try {
            setLoading(true);
            setError(null);
            const result: FileNodeInfo[] = await invoke('read_directory', { path: nodeData.path });
            setFiles(result);
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDir();
    }, [nodeData.path]);


    useEffect(() => {
        const handleClickOutside = () => {
            setMenuState(prev => ({ ...prev, visible: false }));
        };
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    const rowVirtualizer = useVirtualizer({
        count: files.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 36, // height of each row
        overscan: 5,
    });

    const handleClick = (file: FileNodeInfo, e: React.MouseEvent) => {
        if (e.ctrlKey || e.metaKey) {
            // Ctrl+click: toggle selection
            setSelectedFiles(prev => {
                const next = new Set(prev);
                if (next.has(file.path)) {
                    next.delete(file.path);
                } else {
                    next.add(file.path);
                }
                return next;
            });
        } else {
            // Normal click: clear multi-select, expand if dir
            setSelectedFiles(new Set());
            if (file.is_dir && nodeData.onExpand) {
                nodeData.onExpand(id, file.path, true);
            }
        }
    };

    const handleDoubleClick = async (file: FileNodeInfo) => {
        if (!file.is_dir) {
            try {
                await invoke('system_open', { path: file.path });
            } catch (err) {
                console.error("Failed to open file", err);
            }
        }
    };

    const handleContextMenuEmpty = (e: React.MouseEvent) => {
        e.preventDefault();
        setMenuState({
            x: e.nativeEvent.offsetX,
            y: e.nativeEvent.offsetY,
            visible: true,
            target: null,
        });
    };

    const handleContextMenuRow = (e: React.MouseEvent, file: FileNodeInfo) => {
        e.preventDefault();
        e.stopPropagation();

        // If rightclicked file isn't in selection, make it the only selection
        if (!selectedFiles.has(file.path)) {
            setSelectedFiles(new Set([file.path]));
        }

        // Find position relative to the container
        const containerRect = parentRef.current?.getBoundingClientRect();
        const x = containerRect ? e.clientX - containerRect.left : e.nativeEvent.offsetX;
        const y = containerRect ? e.clientY - containerRect.top + 40 : e.nativeEvent.offsetY;

        setMenuState({
            x: x,
            y: y,
            visible: true,
            target: file,
        });
    };

    // Get list of paths that are currently selected (for batch ops)
    const getSelectedPaths = (): string[] => {
        if (selectedFiles.size > 0) {
            return Array.from(selectedFiles);
        }
        if (menuState.target) {
            return [menuState.target.path];
        }
        return [];
    };

    const selectionCount = selectedFiles.size > 1 ? selectedFiles.size : 0;

    // --- Context Menu Actions ---
    const MENU_ACTIONS = {
        refresh: () => {
            fetchDir();
        },
        copy: () => {
            const paths = getSelectedPaths();
            if (paths.length > 0) {
                setClipboardPaths(paths);
                setClipboardMode('copy');
            }
        },
        cut: () => {
            const paths = getSelectedPaths();
            if (paths.length > 0) {
                setClipboardPaths(paths);
                setClipboardMode('cut');
            }
        },
        paste: async (targetDir: string) => {
            if (clipboardPaths.length === 0) return;
            try {
                for (const sourcePath of clipboardPaths) {
                    if (clipboardMode === 'cut') {
                        await invoke('move_path', { sourcePath, targetDir });
                    } else {
                        await invoke('copy_path', { sourcePath, targetDir });
                    }
                }
                if (clipboardMode === 'cut') {
                    setClipboardPaths([]);
                    setClipboardMode(null);
                }
                fetchDir();
            } catch (err) {
                alert(`Paste Failed: ${err}`);
            }
        },
        rename: async () => {
            if (!menuState.target) return;
            const newName = prompt("Enter new name:", menuState.target.name);
            if (newName && newName !== menuState.target.name) {
                try {
                    await invoke('rename_path', { oldPath: menuState.target.path, newName });
                    fetchDir();
                } catch (err) {
                    alert(`Rename Failed: ${err}`);
                }
            }
        },
        delete: async () => {
            const paths = getSelectedPaths();
            if (paths.length === 0) return;
            const msg = paths.length > 1
                ? `Are you sure you want to delete ${paths.length} items?`
                : `Are you sure you want to delete ${menuState.target?.name || 'this item'}?`;
            if (confirm(msg)) {
                try {
                    for (const p of paths) {
                        await invoke('delete_path', { path: p });
                    }
                    setSelectedFiles(new Set());
                    fetchDir();
                } catch (err) {
                    alert(`Delete Failed: ${err}`);
                }
            }
        },
        openFile: async () => {
            if (!menuState.target) return;
            try {
                await invoke('system_open', { path: menuState.target.path });
            } catch (err) {
                console.error("Failed to open", err);
            }
        },
        revealInExplorer: async () => {
            const targetPath = menuState.target ? menuState.target.path : nodeData.path;
            try {
                await invoke('reveal_in_explorer', { path: targetPath });
            } catch (err) {
                console.error("Failed to reveal", err);
            }
        },
        openParentFolder: () => {
            if (menuState.target) return; // Only allow on empty area

            let parentPath = "";
            const parts = nodeData.path.split(/[\\/]/);
            if (parts.length > 1 && parts[parts.length - 1] !== "") {
                parts.pop();
                parentPath = parts.join('\\');
                if (parentPath.endsWith(':')) parentPath += '\\'; // C: -> C:\
            }

            if (parentPath && nodeData.onOpenParent) {
                nodeData.onOpenParent(id, parentPath);
            }
        },
        removeView: () => {
            if (nodeData.onRemoveNode) {
                nodeData.onRemoveNode(id);
            }
        }
    };

    return (
        <div
            className={cn("folder-node-container", selected && "selected")}
            onContextMenu={handleContextMenuEmpty}
        >
            {!nodeData.isRoot && (
                <Handle type="target" position={Position.Left} className="handle-target" />
            )}

            <div className="folder-header">
                {nodeData.isRoot ? <HardDrive size={18} className="text-blue-400" /> : <Folder size={18} className="text-blue-400" />}
                <span className="folder-title" title={nodeData.path}>
                    {nodeData.label}
                </span>
                <span className="folder-count">{files.length}</span>
            </div>

            <div className="folder-content nowheel" ref={parentRef}>
                {loading && (
                    <div className="flex-center p-4 text-slate-400">
                        <Loader2 className="animate-spin mr-2" size={16} /> Reading...
                    </div>
                )}

                {error && (
                    <div className="text-red-400 text-xs p-3">
                        Error: {error}
                    </div>
                )}

                {!loading && !error && files.length === 0 && (
                    <div className="flex-center p-4 text-slate-500 text-sm">
                        Empty folder
                    </div>
                )}

                {!loading && !error && files.length > 0 && (
                    <div
                        className="virtual-list-inner"
                        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                            const file = files[virtualItem.index];
                            const isSelected = selectedFiles.has(file.path);
                            const isCutTarget = clipboardMode === 'cut' && clipboardPaths.includes(file.path);
                            return (
                                <div
                                    key={virtualItem.key}
                                    className={cn("file-row group", isSelected && "file-row-selected", isCutTarget && "file-row-cut")}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: `${virtualItem.size}px`,
                                        transform: `translateY(${virtualItem.start}px)`,
                                    }}
                                    onClick={(e) => handleClick(file, e)}
                                    onDoubleClick={() => handleDoubleClick(file)}
                                    onContextMenu={(e) => handleContextMenuRow(e, file)}
                                >
                                    <div className="file-row-content">
                                        {file.is_dir ? (
                                            <Folder size={16} className="text-blue-400 mr-2 flex-shrink-0" />
                                        ) : (
                                            <File size={16} className="text-slate-400 mr-2 flex-shrink-0" />
                                        )}
                                        <span className="file-name truncate" title={file.name}>
                                            {file.name}
                                        </span>
                                        {file.is_dir && (
                                            <ChevronRight
                                                size={16}
                                                className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
                                            />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {menuState.visible && (
                <div
                    className="context-menu glass-panel"
                    style={{ left: menuState.x, top: menuState.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {!menuState.target ? (
                        <>
                            {/* Empty area (Current Node Folder) */}
                            <button className="menu-item" onClick={MENU_ACTIONS.refresh}>
                                <RefreshCw size={14} /> Refresh
                            </button>
                            <button className="menu-item" onClick={MENU_ACTIONS.revealInExplorer}>
                                <FolderOpen size={14} /> Reveal in Explorer
                            </button>
                            {!nodeData.isRoot && (
                                <button className="menu-item" onClick={MENU_ACTIONS.openParentFolder}>
                                    <Folder size={14} /> Open Parent Folder
                                </button>
                            )}
                            <div className="menu-divider"></div>
                            <button className="menu-item" onClick={MENU_ACTIONS.copy}>
                                <Copy size={14} /> Copy this folder
                            </button>
                            <button className="menu-item" onClick={MENU_ACTIONS.cut}>
                                <Scissors size={14} /> Cut this folder
                            </button>
                            <button
                                className="menu-item"
                                disabled={clipboardPaths.length === 0}
                                onClick={() => MENU_ACTIONS.paste(nodeData.path)}
                            >
                                <ClipboardPaste size={14} /> Paste Here {clipboardMode === 'cut' ? '(Move)' : ''}
                            </button>
                            {!nodeData.isRoot && (
                                <>
                                    <div className="menu-divider"></div>
                                    <button className="menu-item text-red-400 hover:text-red-300" onClick={MENU_ACTIONS.delete}>
                                        <Trash2 size={14} /> Delete this folder
                                    </button>
                                    <button className="menu-item text-yellow-500 hover:text-yellow-400" onClick={MENU_ACTIONS.removeView}>
                                        <XCircle size={14} /> Remove node from view
                                    </button>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            {/* Target row (File or Folder) */}
                            <button className="menu-item" onClick={MENU_ACTIONS.openFile}>
                                <ExternalLink size={14} /> {menuState.target.is_dir ? 'Open (System Default)' : 'Open'}
                            </button>
                            <button className="menu-item" onClick={MENU_ACTIONS.revealInExplorer}>
                                <FolderOpen size={14} /> Reveal in Explorer
                            </button>

                            <div className="menu-divider"></div>
                            <button className="menu-item" onClick={MENU_ACTIONS.copy}>
                                <Copy size={14} /> {selectionCount > 0 ? `Copy ${selectionCount} items` : 'Copy'}
                            </button>
                            <button className="menu-item" onClick={MENU_ACTIONS.cut}>
                                <Scissors size={14} /> {selectionCount > 0 ? `Cut ${selectionCount} items` : 'Cut'}
                            </button>
                            {menuState.target.is_dir && (
                                <button
                                    className="menu-item"
                                    disabled={clipboardPaths.length === 0}
                                    onClick={() => MENU_ACTIONS.paste(menuState.target!.path)}
                                >
                                    <ClipboardPaste size={14} /> Paste Into {clipboardMode === 'cut' ? '(Move)' : ''}
                                </button>
                            )}
                            <div className="menu-divider"></div>
                            <button className="menu-item" onClick={MENU_ACTIONS.rename}>
                                <Edit2 size={14} /> Rename
                            </button>
                            <button className="menu-item text-red-400 hover:text-red-300" onClick={MENU_ACTIONS.delete}>
                                <Trash2 size={14} /> {selectionCount > 0 ? `Delete ${selectionCount} items` : 'Delete'}
                            </button>
                        </>
                    )}
                </div>
            )}

            <Handle type="source" position={Position.Right} className="handle-source" />
        </div>
    );
}
