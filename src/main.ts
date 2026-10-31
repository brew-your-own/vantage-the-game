import * as THREE from 'three';

const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a1a);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
camera.position.set(0, 2, 5);

const mesh = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 0.4, 6),
  new THREE.MeshLambertMaterial({ color: 0x3fa34d, flatShading: true }),
);
scene.add(mesh, new THREE.HemisphereLight(0xffffff, 0x222244, 1.2));

function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop((t) => {
  mesh.rotation.y = t / 1000;
  renderer.render(scene, camera);
});
