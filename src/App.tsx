import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  MarkerType,
  SelectionMode,
  applyNodeChanges,
  NodeChange,
  useReactFlow,
} from '@xyflow/react';
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { FolderNode } from './components/FolderNode';
import { FolderNodeData, SearchResult } from './types';
import { Search, X } from 'lucide-react';
import './App.css';

// Global context for clipboard to be accessible by all nodes
export const ClipboardContext = React.createContext<{
  clipboardPaths: string[];
  setClipboardPaths: (paths: string[]) => void;
  clipboardMode: 'copy' | 'cut' | null;
  setClipboardMode: (mode: 'copy' | 'cut' | null) => void;
}>({
  clipboardPaths: [],
  setClipboardPaths: () => { },
  clipboardMode: null,
  setClipboardMode: () => { },
});

const X_OFFSET = 360;
const Y_OFFSET = 340;
const NODE_WIDTH = 280;
const NODE_HEIGHT = 400; // rough max height

// Helper to check AABB collision
function checkCollision(nodeA: Node, nodeB: Node): boolean {
  if (nodeA.id === nodeB.id) return false;
  return (
    nodeA.position.x < nodeB.position.x + NODE_WIDTH &&
    nodeA.position.x + NODE_WIDTH > nodeB.position.x &&
    nodeA.position.y < nodeB.position.y + NODE_HEIGHT &&
    nodeA.position.y + NODE_HEIGHT > nodeB.position.y
  );
}

function App() {
  const [nodes, setNodes] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [clipboardPaths, setClipboardPaths] = useState<string[]>([]);
  const [clipboardMode, setClipboardMode] = useState<'copy' | 'cut' | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ scanned: number; current: string } | null>(null);
  const [searchFilter, setSearchFilter] = useState('all');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const reactFlowInstance = useReactFlow();

  const handleRemoveNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }, [setNodes, setEdges]);

  // Function to handle clicking on a folder
  const handleExpand = useCallback(
    (parentId: string, childPath: string, _isExpanded: boolean) => {
      setNodes((nds) => {
        // Child's unique ID can simply be its path
        const childId = childPath;

        // Check if the node already exists
        if (nds.find((n) => n.id === childId)) {
          return nds;
        }

        const parentNode = nds.find((n) => n.id === parentId);
        if (!parentNode) return nds;

        const siblingsCount = edges.filter((e) => e.source === parentId).length;
        const newY = parentNode.position.y + (siblingsCount * Y_OFFSET);
        const newX = parentNode.position.x + X_OFFSET;

        const newNode: Node<FolderNodeData> = {
          id: childId,
          type: 'folder',
          position: { x: newX, y: newY },
          data: {
            label: childPath.split('\\').pop() || childPath.split('/').pop() || childPath,
            path: childPath,
            onExpand: handleExpand,
            onRemoveNode: handleRemoveNode,
            onOpenParent: handleOpenParent,
          },
        };

        // Collision avoidance
        let isColliding = true;
        let attempts = 0;
        while (isColliding && attempts < 10) {
          isColliding = false;
          for (const existingNode of nds) {
            if (checkCollision(newNode, existingNode)) {
              newNode.position.y += Math.random() > 0.5 ? 50 : -50;
              newNode.position.x += 20;
              isColliding = true;
              break;
            }
          }
          attempts++;
        }

        return [...nds, newNode];
      });

      setEdges((eds) => {
        const edgeId = `e-${parentId}-${childPath}`;
        if (eds.find((e) => e.id === edgeId)) return eds;

        const newEdge: Edge = {
          id: edgeId,
          source: parentId,
          target: childPath,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#3b82f6', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#3b82f6',
          },
        };
        return [...eds, newEdge];
      });
    },
    [setNodes, setEdges, edges]
  );

  const handleOpenParent = useCallback(
    (childId: string, parentPath: string) => {
      setNodes((nds) => {
        const parentId = parentPath;
        const childNode = nds.find(n => n.id === childId);
        if (!childNode) return nds;

        // Parent likely exists but let's see
        if (nds.find(n => n.id === parentId)) {
          return nds;
        }

        const newX = childNode.position.x - X_OFFSET;
        const newY = childNode.position.y;

        const newParentNode: Node<FolderNodeData> = {
          id: parentId,
          type: 'folder',
          position: { x: newX, y: newY },
          data: {
            label: parentPath.split('\\').pop() || parentPath.split('/').pop() || parentPath,
            path: parentPath,
            onExpand: handleExpand,
            onRemoveNode: handleRemoveNode,
            onOpenParent: handleOpenParent,
          },
        };
        return [...nds, newParentNode];
      });

      setEdges((eds) => {
        const edgeId = `e-${parentPath}-${childId}`;
        if (eds.find((e) => e.id === edgeId)) return eds;

        const newEdge: Edge = {
          id: edgeId,
          source: parentPath,
          target: childId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#3b82f6', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#3b82f6',
          },
        };
        return [...eds, newEdge];
      });
    },
    [setNodes, setEdges, handleExpand, handleRemoveNode]
  );

  // Load root nodes explicitly from Rust
  useEffect(() => {
    const fetchRoots = async () => {
      try {
        const roots: { path: string, label: string }[] = await invoke('get_system_roots');

        if (nodes.length === 0) {
          const initialNodes: Node<FolderNodeData>[] = roots.map((root, index) => ({
            id: `root-${root.path}`,
            type: 'folder',
            position: { x: 100, y: 150 + (index * (NODE_HEIGHT + 40)) },
            data: {
              label: root.label,
              path: root.path,
              isRoot: true,
              onExpand: handleExpand,
              onRemoveNode: handleRemoveNode,
              onOpenParent: handleOpenParent,
            },
          }));
          setNodes(initialNodes);
        }
      } catch (err) {
        console.error("Failed to fetch system roots", err);
      }
    };
    fetchRoots();
    // Intentionally run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for search progress from Rust
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<{ scanned_count: number; current_path: string }>('search-progress', (event) => {
      setSearchProgress({
        scanned: event.payload.scanned_count,
        current: event.payload.current_path
      });
    }).then((rm) => {
      unlisten = rm;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Handle keyboard panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If any node is selected, don't hijack arrow keys
      if (nodes.some(n => n.selected)) return;

      const PAN_AMOUNT = 50;
      const { x, y, zoom } = reactFlowInstance.getViewport();

      switch (e.key) {
        case 'ArrowUp':
          reactFlowInstance.setViewport({ x, y: y + PAN_AMOUNT, zoom });
          break;
        case 'ArrowDown':
          reactFlowInstance.setViewport({ x, y: y - PAN_AMOUNT, zoom });
          break;
        case 'ArrowLeft':
          reactFlowInstance.setViewport({ x: x + PAN_AMOUNT, y, zoom });
          break;
        case 'ArrowRight':
          reactFlowInstance.setViewport({ x: x - PAN_AMOUNT, y, zoom });
          break;
      }
    };

    // Only attach if not typing in an input
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      handleKeyDown(e);
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [nodes, reactFlowInstance]);

  // Custom onNodesChange to prevent visual overlap during drag
  const onNodesChangeCustom = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => {
      const nextNodes = applyNodeChanges(changes, nds);

      // Look for dragged nodes and prevent overlap
      for (const change of changes) {
        if (change.type === 'position' && change.dragging) {
          const movedNode = nextNodes.find(n => n.id === change.id);
          if (!movedNode) continue;

          for (const otherNode of nextNodes) {
            if (otherNode.id !== movedNode.id && checkCollision(movedNode, otherNode)) {
              // Resolve collision simple push back
              movedNode.position.x -= 10;
              movedNode.position.y -= 10;
            }
          }
        }
      }
      return nextNodes as Node[];
    });
  }, [setNodes]);

  // Debounced search effect (1. 实时搜索)
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      setHighlightedIndex(-1);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        setSearchProgress({ scanned: 0, current: '' });
        const results: SearchResult[] = await invoke('search_files', { query: searchQuery, filter: searchFilter });
        setSearchResults(results);
        setHighlightedIndex(-1);
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsSearching(false);
        setSearchProgress(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchFilter]);

  // Cancel search handler (3. 取消搜索)
  const handleCancelSearch = async () => {
    try {
      await invoke('cancel_search');
    } catch (_) { /* ignore */ }
    setIsSearching(false);
    setSearchProgress(null);
  };

  // Close search results (8. ESC 关闭)
  const handleCloseResults = () => {
    setSearchResults([]);
    setSearchQuery('');
    setHighlightedIndex(-1);
  };

  // Keyboard navigation for search results (5. 键盘导航)
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCloseResults();
      return;
    }

    if (searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      spawnSearchResult(searchResults[highlightedIndex]);
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && resultsRef.current) {
      const items = resultsRef.current.querySelectorAll('.search-result-item');
      items[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  const spawnSearchResult = (result: SearchResult) => {
    // If it's a directory, spawn as folder node
    // If it's a file, open the parent dir as folder node
    const targetPath = result.is_dir ? result.path : result.parent_path;
    const label = result.is_dir ? result.name : result.parent_path.split('\\').pop() || result.parent_path;

    setNodes((nds) => {
      if (nds.find(n => n.id === targetPath)) return nds;
      const newNode: Node<FolderNodeData> = {
        id: targetPath,
        type: 'folder',
        position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: {
          label,
          path: targetPath,
          onExpand: handleExpand,
          onRemoveNode: handleRemoveNode,
          onOpenParent: handleOpenParent,
        },
      };
      return [...nds, newNode];
    });
    setSearchResults([]);
    setSearchQuery('');
    setHighlightedIndex(-1);
  };

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const nodeTypes = useMemo(() => ({ folder: FolderNode as any }), []);

  return (
    <div className="App">
      <ClipboardContext.Provider value={{ clipboardPaths, setClipboardPaths, clipboardMode, setClipboardMode }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChangeCustom}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          panOnDrag={[1, 2]} // Middle or Right click to pan
          selectionOnDrag={true} // Left click to frame selection
          selectionMode={SelectionMode.Partial}
          deleteKeyCode={['Backspace', 'Delete']}
          panOnScroll={true}
          onPaneContextMenu={(e) => e.preventDefault()}
          fitView
        >
          <Background gap={24} size={1} color="#334155" />
          <MiniMap
            nodeColor={(node) => {
              const d = node.data as FolderNodeData;
              if (d?.isRoot) return '#3b82f6';
              return '#60a5fa';
            }}
            nodeStrokeColor={(node) => {
              const d = node.data as FolderNodeData;
              if (d?.isRoot) return '#1d4ed8';
              return '#2563eb';
            }}
            nodeStrokeWidth={3}
            maskColor="rgba(15, 23, 42, 0.6)"
            style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
          />
          <Panel position="top-left" className="custom-panel pointer-events-auto">
            <div className="flex flex-col gap-2">
              <span className="font-semibold text-slate-200">File Node Manager</span>
              <div className="relative mt-2" onKeyDown={handleSearchKeyDown}>
                <div className="flex items-center gap-2">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Type to search... (min 2 chars)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-slate-800 text-sm text-slate-200 border border-slate-700 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500 w-[240px]"
                  />
                  {isSearching ? (
                    <button
                      type="button"
                      onClick={handleCancelSearch}
                      className="p-1.5 bg-red-600 hover:bg-red-500 rounded-md text-white transition-colors"
                      title="Cancel search"
                    >
                      <X size={16} />
                    </button>
                  ) : searchQuery ? (
                    <button
                      type="button"
                      onClick={handleCloseResults}
                      className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-slate-300 transition-colors"
                      title="Clear"
                    >
                      <X size={16} />
                    </button>
                  ) : (
                    <div className="p-1.5 text-slate-500">
                      <Search size={16} />
                    </div>
                  )}
                </div>
                {/* Filter dropdown */}
                <select
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="mt-1.5 w-full bg-slate-800 text-xs text-slate-300 border border-slate-700 rounded-md px-2 py-1 focus:outline-none"
                >
                  <option value="all">All types</option>
                  <option value="dirs">Folders only</option>
                  <option value="files">Files only</option>
                  <option value=".pdf">.pdf</option>
                  <option value=".docx">.docx</option>
                  <option value=".txt">.txt</option>
                  <option value=".jpg">.jpg</option>
                  <option value=".png">.png</option>
                </select>
                {isSearching && searchProgress && (
                  <div className="text-xs text-slate-400 mt-2 truncate w-[270px]" title={searchProgress.current}>
                    Scanning... ({searchProgress.scanned})<br />
                    {searchProgress.current}
                  </div>
                )}
                {searchResults.length > 0 && (
                  <div
                    ref={resultsRef}
                    className="absolute top-full left-0 mt-2 w-[320px] bg-slate-800 border border-slate-700 rounded-md shadow-xl max-h-[350px] overflow-y-auto z-50 nowheel"
                    onWheel={(e) => e.stopPropagation()}
                  >
                    <div className="sticky top-0 bg-slate-800 px-2 py-1 text-xs text-slate-500 border-b border-slate-700">
                      {searchResults.length} results {searchResults.length >= 200 && '(max reached)'}
                    </div>
                    {searchResults.map((res, i) => (
                      <div
                        key={i}
                        onClick={() => spawnSearchResult(res)}
                        className={`search-result-item p-2 cursor-pointer text-sm flex flex-col gap-0.5 ${i === highlightedIndex ? 'bg-blue-600/30' : 'hover:bg-slate-700'
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-slate-200 truncate" title={res.name}>{res.name}</span>
                          {res.is_dir && <span className="text-xs text-blue-400 border border-blue-400/30 px-1 rounded ml-auto flex-shrink-0">DIR</span>}
                        </div>
                        <span className="text-xs text-slate-500 truncate" title={res.parent_path}>
                          {res.parent_path}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </ReactFlow>
      </ClipboardContext.Provider>
    </div>
  );
}

export default App;
