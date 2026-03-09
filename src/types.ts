export interface FileNodeInfo {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    extension: string | null;
}

export interface SearchResult {
    path: string;
    name: string;
    is_dir: boolean;
    parent_path: string;
}

export interface FolderNodeData extends Record<string, unknown> {
    label: string;
    path: string;
    isRoot?: boolean;
    onExpand?: (nodeId: string, path: string, isExpanded: boolean) => void;
    onRemoveNode?: (nodeId: string) => void;
    onOpenParent?: (childId: string, parentPath: string) => void;
    expanded?: boolean;
}
