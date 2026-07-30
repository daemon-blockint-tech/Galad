'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type * as THREE from 'three';
import { Graph3DRenderer } from '@/core/graph/Graph3DRenderer';
import { ZoomIn, ZoomOut, RotateCcw, Maximize2 } from 'lucide-react';

interface Entity {
  id: string;
  label: string;
  threatLevel: number;
  confidence: number;
  x?: number;
  y?: number;
  z?: number;
}

interface Relationship {
  source: string;
  target: string;
  strength: number;
  confidence: number;
}

export interface Graph3DVisualizationProps {
  entities: Entity[];
  relationships: Relationship[];
  onNodeSelect?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  autoRotate?: boolean;
  cameraSpeed?: number;
}

/**
 * 3D graph visualization component using Three.js.
 */
export function Graph3DVisualization({
  entities,
  relationships,
  onNodeSelect,
  onNodeHover,
  autoRotate = true,
  cameraSpeed = 0.5,
}: Graph3DVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const graphRef = useRef<Graph3DRenderer | null>(null);
  const raycasterRef = useRef<any>(null);
  const cameraRotationRef = useRef({ x: 0, y: 0 });

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [stats, setStats] = useState({ nodes: 0, links: 0, fps: 0 });
  const [isSimulating, setIsSimulating] = useState(true);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Dynamically import Three.js
    Promise.all([import('three'), import('three/examples/jsm/controls/OrbitControls.js')]).then(
      ([THREE, OrbitControlsModule]) => {
        const OrbitControls = OrbitControlsModule.OrbitControls;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0f172a);
        sceneRef.current = scene;

        // Camera
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
        camera.position.set(0, 0, 200);
        cameraRef.current = camera;

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current?.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Orbit controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.autoRotate = autoRotate;
        controls.autoRotateSpeed = cameraSpeed;
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;

        // Initialize graph
        const graph = new Graph3DRenderer();
        graphRef.current = graph;

        // Add entities as nodes
        for (const entity of entities) {
          const size = 1 + entity.confidence * 4;
          const color = getThreatColor(entity.threatLevel);

          graph.addNode({
            id: entity.id,
            label: entity.label,
            x: (Math.random() - 0.5) * 200,
            y: (Math.random() - 0.5) * 200,
            z: (Math.random() - 0.5) * 200,
            vx: 0,
            vy: 0,
            vz: 0,
            fx: 0,
            fy: 0,
            fz: 0,
            threatLevel: entity.threatLevel,
            confidence: entity.confidence,
            size,
            color,
          });
        }

        // Add relationships as links
        for (const rel of relationships) {
          graph.addLink({
            source: rel.source,
            target: rel.target,
            strength: rel.strength,
            confidence: rel.confidence,
          });
        }

        // Create node meshes
        const nodes = graph.getNodes();
        const nodeMeshes = new Map<string, THREE.Mesh>();

        for (const node of nodes) {
          const geometry = new THREE.SphereGeometry(node.size, 32, 32);
          const material = new THREE.MeshPhongMaterial({ color: node.color });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(node.x, node.y, node.z);
          mesh.userData.nodeId = node.id;
          scene.add(mesh);
          nodeMeshes.set(node.id, mesh);
        }

        // Create link meshes
        const linkMeshes: THREE.Line[] = [];
        const links = graph.getLinks();

        for (const link of links) {
          const sourceNode = graph.getNode(link.source);
          const targetNode = graph.getNode(link.target);
          if (!sourceNode || !targetNode) continue;

          const geometry = new THREE.BufferGeometry();
          const positions = [sourceNode.x, sourceNode.y, sourceNode.z, targetNode.x, targetNode.y, targetNode.z];
          geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));

          const material = new THREE.LineBasicMaterial({
            color: 0x4ade80,
            opacity: link.confidence * 0.5,
            transparent: true,
          });

          const line = new THREE.Line(geometry, material);
          scene.add(line);
          linkMeshes.push(line);
        }

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 100, 100);
        scene.add(directionalLight);

        // Mouse interaction
        const raycaster = new THREE.Raycaster();
        raycasterRef.current = raycaster;
        const pointer = new THREE.Vector2();

        const onMouseMove = (event: MouseEvent) => {
          pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
          pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

          raycaster.setFromCamera(pointer, camera);
          const intersects = raycaster.intersectObjects(Array.from(nodeMeshes.values()));

          let hoveredId: string | null = null;
          if (intersects.length > 0) {
            hoveredId = (intersects[0].object as any).userData.nodeId;
          }

          setHoveredNode(hoveredId);
          onNodeHover?.(hoveredId);
        };

        const onClick = (event: MouseEvent) => {
          raycaster.setFromCamera(pointer, camera);
          const intersects = raycaster.intersectObjects(Array.from(nodeMeshes.values()));

          if (intersects.length > 0) {
            const nodeId = (intersects[0].object as any).userData.nodeId;
            setSelectedNode(nodeId);
            onNodeSelect?.(nodeId);

            // Pin the node
            graph.setNodePin(nodeId, true);
          }
        };

        renderer.domElement.addEventListener('mousemove', onMouseMove);
        renderer.domElement.addEventListener('click', onClick);
        window.addEventListener('resize', () => {
          const width = window.innerWidth;
          const height = window.innerHeight;
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
        });

        // Animation loop
        let frameCount = 0;
        let lastTime = Date.now();

        const animate = () => {
          requestAnimationFrame(animate);

          // Force simulation
          if (isSimulating) {
            graph.simulateForces(1);
          }

          // Update node positions
          for (const node of graph.getNodes()) {
            const mesh = nodeMeshes.get(node.id);
            if (mesh) {
              mesh.position.set(node.x, node.y, node.z);

              // Highlight selected/hovered nodes
              if (node.id === selectedNode) {
                (mesh.material as THREE.MeshPhongMaterial).emissive.setHex(0xff6b00);
              } else if (node.id === hoveredNode) {
                (mesh.material as THREE.MeshPhongMaterial).emissive.setHex(0xfbbf24);
              } else {
                (mesh.material as THREE.MeshPhongMaterial).emissive.setHex(0x000000);
              }
            }
          }

          // Update link positions
          const links = graph.getLinks();
          for (let i = 0; i < linkMeshes.length; i++) {
            const link = links[i];
            const sourceNode = graph.getNode(link.source);
            const targetNode = graph.getNode(link.target);

            if (sourceNode && targetNode) {
              const positions = (linkMeshes[i].geometry as THREE.BufferGeometry).attributes
                .position as THREE.BufferAttribute;
              positions.setXYZ(0, sourceNode.x, sourceNode.y, sourceNode.z);
              positions.setXYZ(1, targetNode.x, targetNode.y, targetNode.z);
              positions.needsUpdate = true;
            }
          }

          // Update controls and camera
          controls.update();

          // FPS calculation
          frameCount++;
          const now = Date.now();
          if (now - lastTime >= 1000) {
            setStats({
              nodes: graph.getNodeCount(),
              links: graph.getLinkCount(),
              fps: frameCount,
            });
            frameCount = 0;
            lastTime = now;
          }

          renderer.render(scene, camera);
        };

        animate();

        // Cleanup
        return () => {
          renderer.domElement.removeEventListener('mousemove', onMouseMove);
          renderer.domElement.removeEventListener('click', onClick);
          renderer.dispose();
        };
      },
    );
  }, [entities, relationships, autoRotate, cameraSpeed, onNodeSelect, onNodeHover]);

  const getThreatColor = (threatLevel: number): string => {
    if (threatLevel > 0.8) return '#dc2626';
    if (threatLevel > 0.6) return '#f97316';
    if (threatLevel > 0.4) return '#eab308';
    return '#22c55e';
  };

  const handleResetCamera = () => {
    if (cameraRef.current) {
      cameraRef.current.position.set(0, 0, 200);
      cameraRef.current.lookAt(0, 0, 0);
    }
  };

  const handleToggleSimulation = () => {
    setIsSimulating(!isSimulating);
  };

  return (
    <div className="relative w-full h-screen bg-slate-950">
      <div ref={containerRef} className="w-full h-full" />

      {/* Controls */}
      <div className="absolute bottom-6 left-6 flex gap-2">
        <button
          onClick={handleResetCamera}
          className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition"
          title="Reset camera"
        >
          <RotateCcw size={20} />
        </button>

        <button
          onClick={handleToggleSimulation}
          className={`p-2 rounded-lg transition ${
            isSimulating ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-800 hover:bg-slate-700'
          } text-white`}
          title="Toggle force simulation"
        >
          <Maximize2 size={20} />
        </button>
      </div>

      {/* Stats */}
      <div className="absolute top-6 right-6 bg-slate-900 text-slate-300 rounded-lg p-4 text-sm space-y-1 font-mono">
        <div>Nodes: {stats.nodes}</div>
        <div>Links: {stats.links}</div>
        <div>FPS: {stats.fps}</div>
        {selectedNode && <div className="text-blue-400">Selected: {selectedNode}</div>}
      </div>

      {/* Legend */}
      <div className="absolute top-6 left-6 bg-slate-900 text-slate-300 rounded-lg p-4 text-sm space-y-2">
        <div className="font-semibold text-white mb-2">Threat Level</div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-600"></div>
          <span>Critical (0.8+)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-orange-500"></div>
          <span>High (0.6-0.8)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
          <span>Medium (0.4-0.6)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span>Low (&lt;0.4)</span>
        </div>
      </div>
    </div>
  );
}
