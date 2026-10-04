// VRM optimization pipeline (PRD section 3: "low weighted, runs on browser easily,
// laptop/mobile/tab compatible").
//
// gltf-transform's `optimize` (WebP textures @2048 + meshopt) drops the VRMC_vrm and
// VRMC_springBone extensions it doesn't know. Those extensions are pure JSON metadata
// that reference nodes/meshes/materials BY INDEX, so after optimizing we:
//   1. snapshot them from the ORIGINAL GLB,
//   2. verify gltf-transform kept node/mesh/material order and morph-target counts
//      identical (re-injection is only exact if indices are stable),
//   3. re-inject them into the optimized GLB and rebuild the binary.
// Usage: node tools/optimize-vrm.mjs <input.vrm> <output.vrm>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/optimize-vrm.mjs <input.vrm> <output.glb>');
  process.exit(1);
}

// VRM 1.0 keeps its metadata in VRMC_vrm/VRMC_springBone; legacy VRM 0.x models
// carry a single "VRM" extension (humanoid/firstPerson/blendShapeMaster/
// secondaryAnimation all reference nodes/meshes by index inside it).
const VRM_EXTENSIONS = ['VRMC_vrm', 'VRMC_springBone', 'VRM'];

function readGlbJson(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file} is not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  return { buf, json: JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)) };
}

function writeGlb(file, json, binBuf) {
  const jsonStr = JSON.stringify(json);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const binPad = (4 - (binBuf.length % 4)) % 4;
  const total = 12 + 8 + jsonStr.length + jsonPad + 8 + binBuf.length + binPad;
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'ascii');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonStr.length + jsonPad, 12);
  out.write('JSON', 16, 'ascii');
  out.write(jsonStr, 20);
  for (let i = 0; i < jsonPad; i++) out.write(' ', 20 + jsonStr.length + i);
  const binChunk = 20 + jsonStr.length + jsonPad;
  out.writeUInt32LE(binBuf.length + binPad, binChunk);
  out.write('BIN\0', binChunk + 4, 'ascii');
  binBuf.copy(out, binChunk + 8);
  if (binPad) out.fill(0, binChunk + 8 + binBuf.length);
  fs.writeFileSync(file, out);
}

function binBufferOf(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const binHeader = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeader);
  return buf.slice(binHeader + 8, binHeader + 8 + binLen);
}

// --- 1. snapshot VRM metadata from the source ---
const { json: orig } = readGlbJson(input);
const vrmMeta = {};
for (const name of VRM_EXTENSIONS) {
  if (orig.extensions?.[name]) vrmMeta[name] = orig.extensions[name];
}
if (!vrmMeta.VRMC_vrm && !vrmMeta.VRM) {
  throw new Error('input has no VRMC_vrm / VRM extension — not a VRM?');
}
const isVrm0 = !vrmMeta.VRMC_vrm && !!vrmMeta.VRM;
console.log(`[snapshot] captured: ${Object.keys(vrmMeta).join(', ')} (VRM ${isVrm0 ? '0.x' : '1.0'})`);

const seq = (arr, key) => (arr || []).map((x) => x.name || '');
const origNodes = seq(orig.nodes);
const origMeshes = seq(orig.meshes);
const origMats = seq(orig.materials);
const origMorphCounts = (orig.meshes || []).map((m) =>
  m.primitives.map((p) => (p.targets || []).length).join(',')
);

// --- 2. optimize via gltf-transform CLI (single GLB out) ---
// shell:true is required on Windows: Node >= 20 refuses to spawn npx.cmd directly
// (EINVAL, CVE-2024-27980), and argv contains no quoting-sensitive characters.
//
// We deliberately do NOT use the `optimize` command here: it hardcodes
// `transforms = [dedup()]` (merges byte-identical textures) and prune-solid-textures,
// both of which REMOVE/REINDEX textures. VRM 0.x metadata (materialProperties[].texture,
// meta.texture) references textures BY INDEX, so any texture removal leaves those
// pointing at wrong/missing slots — three-vrm's v0compat then crashes at load time
// in GLTFTextureBasisUExtension. The standalone `webp` + `meshopt` commands transform
// 1:1 in place: texture count and order survive untouched.
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const tmpOut = path.join(path.dirname(output), path.basename(output, '.vrm') + '.opt.glb');
const tmpTex = path.join(path.dirname(output), path.basename(output, '.vrm') + '.tex.glb');
const run = (args) => execFileSync(npx, ['-y', '@gltf-transform/cli', ...args],
  { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
run(['webp', input, tmpTex]);      // re-encode every texture to WebP, 1:1
run(['meshopt', tmpTex, tmpOut]);  // meshopt-compress geometry + morph targets

const { buf: optBuf, json: opt } = readGlbJson(tmpOut);

// --- 3. verify structural stability and build index remaps ---
// gltf-transform may serialize the flat node array in a different order than the
// source even though the scene graph itself is unchanged. VRM metadata references
// nodes/meshes/materials BY INDEX, so we remap through a pre-order traversal of the
// scene (child order is what defines identity) and fail loudly on any drift.
const fail = (msg) => { for (const f of [tmpOut, tmpTex]) { try { fs.unlinkSync(f); } catch {} } throw new Error(`stability check failed: ${msg}`); };

// VRM 0.x metadata references textures by index (materialProperties[].texture,
// meta.texture). gltf-transform READS only scene-graph references, so textures
// used exclusively by VRM metadata (thumbnails, shade textures) are DROPPED from
// the textures array on write — while their image data survives untouched. Any
// VRM reference to a dropped index then crashes three's GLTFTextureBasisUExtension
// at load time (it reads textureDef.extensions without a null guard). Re-attach
// every dropped texture entry: surviving textures keep their original order and
// image mapping, so texture i is rebuilt from original texture i's image source.
const texImage = (t) => t?.source ?? t?.extensions?.EXT_texture_webp?.source ?? t?.extensions?.EXT_texture_avif?.source;
if ((orig.images || []).length !== (opt.images || []).length) {
  fail(`image count ${(orig.images || []).length} != ${(opt.images || []).length}`);
}
for (let i = 0; i < (opt.textures || []).length; i++) {
  if (texImage(orig.textures?.[i]) !== texImage(opt.textures?.[i])) {
    fail(`texture ${i} image mapping drift (${texImage(orig.textures?.[i])} vs ${texImage(opt.textures?.[i])})`);
  }
}
const dropped = (orig.textures || []).length - (opt.textures || []).length;
if (dropped > 0) {
  console.log(`[reattach] ${dropped} scene-unreferenced texture(s) dropped by gltf-transform — rebuilding entries`);
  for (let i = (opt.textures || []).length; i < (orig.textures || []).length; i++) {
    const src = texImage(orig.textures[i]);
    if (src == null) fail(`original texture ${i} has no image source`);
    const sampler = Math.min(orig.textures[i].sampler ?? 0, (opt.samplers || []).length - 1);
    opt.textures[i] = {
      ...(orig.textures[i].name ? { name: orig.textures[i].name } : {}),
      sampler: Math.max(0, sampler),
      extensions: { EXT_texture_webp: { source: src } },
    };
  }
}

function preorder(json) {
  // Flat node indices in pre-order scene traversal (deterministic child order).
  const scenes = json.scenes || [{ nodes: [0] }];
  const seen = new Set();
  const out = [];
  const walk = (i) => {
    if (seen.has(i) || !(json.nodes || [])[i]) return;
    seen.add(i);
    out.push(i);
    for (const c of json.nodes[i].children || []) walk(c);
  };
  for (const s of scenes) for (const root of s.nodes || []) walk(root);
  return out;
}

function mapFromSequences(origSeq, optSeq, label) {
  // Positional mapping between two index sequences with matching names — handles
  // duplicate names correctly (mapping is by position, not by name lookup).
  if (origSeq.length !== optSeq.length) fail(`${label}: sequence length ${origSeq.length} != ${optSeq.length}`);
  const map = new Map();
  for (let k = 0; k < origSeq.length; k++) {
    if (origSeq[k].name !== optSeq[k].name) fail(`${label}: position ${k} name drift "${origSeq[k].name}" vs "${optSeq[k].name}"`);
    map.set(origSeq[k].idx, optSeq[k].idx);
  }
  return map;
}

const origOrder = preorder(orig), optOrder = preorder(opt);
if (origOrder.length !== optOrder.length) fail(`traversal node count ${origOrder.length} != ${optOrder.length}`);
const nodeName = (i) => orig.nodes[i].name ?? `(node ${i})`;
const optNodeName = (i) => opt.nodes[i].name ?? `(node ${i})`;
for (let k = 0; k < origOrder.length; k++) {
  if (nodeName(origOrder[k]) !== optNodeName(optOrder[k])) {
    fail(`traversal position ${k}: "${nodeName(origOrder[k])}" vs "${optNodeName(optOrder[k])}"`);
  }
}
const nodeMap = new Map(origOrder.map((o, k) => [o, optOrder[k]]));

// Mesh + material sequences follow node traversal order (gltf-transform serializes
// them by first use), with primitives kept in per-mesh order.
const origMeshSeq = [], optMeshSeq = [], origMatSeq = [], optMatSeq = [];
for (let k = 0; k < origOrder.length; k++) {
  const oNode = orig.nodes[origOrder[k]], oNodeOpt = opt.nodes[optOrder[k]];
  if (oNode.mesh !== undefined) {
    const oMesh = orig.meshes[oNode.mesh], oMeshOpt = opt.meshes[oNodeOpt.mesh];
    if ((oMesh.name || '') !== (oMeshOpt.name || '')) fail(`mesh name drift on node "${nodeName(origOrder[k])}"`);
    origMeshSeq.push({ idx: oNode.mesh, name: oMesh.name || '' });
    optMeshSeq.push({ idx: oNodeOpt.mesh, name: oMeshOpt.name || '' });
    if (oMesh.primitives.length !== oMeshOpt.primitives.length) fail(`primitive count drift on mesh "${oMesh.name}"`);
    for (let p = 0; p < oMesh.primitives.length; p++) {
      if ((oMesh.primitives[p].targets || []).length !== (oMeshOpt.primitives[p].targets || []).length) {
        fail(`morph target count drift on mesh "${oMesh.name}" prim ${p}`);
      }
      const oMat = oMesh.primitives[p].material, oMatOpt = oMeshOpt.primitives[p].material;
      if ((oMat === undefined) !== (oMatOpt === undefined)) fail(`material presence drift on mesh "${oMesh.name}" prim ${p}`);
      if (oMat !== undefined) {
        origMatSeq.push({ idx: oMat, name: orig.materials[oMat].name || '' });
        optMatSeq.push({ idx: oMatOpt, name: opt.materials[oMatOpt].name || '' });
      }
    }
  }
}
const meshMap = mapFromSequences(origMeshSeq, optMeshSeq, 'meshes');
const matMap = mapFromSequences(origMatSeq, optMatSeq, 'materials');
console.log(`[verify] scene structure identical: ${origOrder.length} nodes, ${meshMap.size} meshes, ${matMap.size} material refs — remapping VRM metadata indices`);

// --- 4. remap all index references inside the VRM metadata, re-inject, rebuild ---
// VRM 0.x extras (all node indices): humanoid.humanBones[].node,
// firstPerson.firstPersonBone, secondaryAnimation.boneGroups[].center,
// boneGroups[].bones (number[]), colliderGroups[].node,
// boneGroups[].colliders (number[] — in colliderGroups it's an array of shape
// objects, so the all-numbers guard keeps it safe). boneGroups[].colliderGroups
// indexes colliderGroups, NOT nodes — never remapped.
const remapMeta = (meta) => JSON.parse(JSON.stringify(meta), (key, value) => {
  if (typeof value === 'number' && (key === 'node' || key === 'firstPersonBone' || key === 'center')) {
    return nodeMap.get(value);
  }
  if (Array.isArray(value) && (key === 'bones' || key === 'colliders') && value.every((v) => typeof v === 'number')) {
    return value.map((v) => nodeMap.get(v));
  }
  if (key === 'mesh' && typeof value === 'number') return meshMap.get(value);
  if (key === 'material' && typeof value === 'number') return matMap.get(value);
  return value;
});
opt.extensions = { ...(opt.extensions || {}) };
for (const [name, meta] of Object.entries(vrmMeta)) opt.extensions[name] = remapMeta(meta);
opt.extensionsUsed = [...new Set([...(opt.extensionsUsed || []), ...Object.keys(vrmMeta)])];
// VRM extensions are load-bearing: if the source listed them as required,
// dropping them from extensionsRequired would make loaders reject the file.
const origRequiredVrm = (orig.extensionsRequired || []).filter((n) => vrmMeta[n]);
if (origRequiredVrm.length) {
  opt.extensionsRequired = [...new Set([...(opt.extensionsRequired || []), ...origRequiredVrm])];
}
writeGlb(output, opt, binBufferOf(optBuf));
fs.unlinkSync(tmpOut);
try { fs.unlinkSync(tmpTex); } catch {}

// --- 5. final integrity check: metadata survives verbatim after remap ---
const { json: fin } = readGlbJson(output);
for (const name of Object.keys(vrmMeta)) {
  if (JSON.stringify(fin.extensions[name]) !== JSON.stringify(opt.extensions[name])) fail(`re-injected ${name} differs`);
}
let boneCount, exprSummary;
if (isVrm0) {
  const vrm0 = fin.extensions.VRM;
  boneCount = (vrm0.humanoid?.humanBones || []).length;
  const groups = vrm0.blendShapeMaster?.blendShapeGroups || [];
  const binds = groups.reduce((n, g) => n + (g.binds || []).length, 0);
  exprSummary = `blendShapeGroups=${groups.length} binds=${binds}`;
} else {
  const vrm1 = fin.extensions.VRMC_vrm;
  exprSummary = `expressions(preset)=${Object.keys(vrm1.expressions?.preset || {}).length}`;
  boneCount = Object.keys(vrm1.humanoid?.humanBones || {}).length;
}
const sizeMB = (fs.statSync(output).size / 1048576).toFixed(2);
const origMB = (fs.statSync(input).size / 1048576).toFixed(2);
console.log(`[done] ${origMB} MB -> ${sizeMB} MB | ${exprSummary} humanBones=${boneCount} images=${(fin.images || []).length} (${(fin.images || []).map((i) => i.mimeType).join(',')})`);
