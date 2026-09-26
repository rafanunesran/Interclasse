// Prepara um modelo 3D (GLB do Tripo ou outro) para o mockup 3D do site
// (js/mockup3d.js): joga fora a textura/UV (a arte entra por projeção),
// solda os vértices e simplifica a malha para ficar leve na web.
//
//   npm i @gltf-transform/core @gltf-transform/functions meshoptimizer
//   node tools/simplificar-glb.mjs entrada.glb saida.glb [proporção] [--abaixo-de Y]
//
// proporção: fração dos triângulos que fica (padrão 0.02 → ~2 M viram ~40 mil).
// --abaixo-de Y: guarda só os triângulos abaixo da altura Y (usado no
// manequim: só as pernas; a camiseta e o pescoço são do site).
import { NodeIO } from "@gltf-transform/core";
import { weld, simplify, dedup, prune, compactPrimitive } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const [entrada, saida, prop = "0.02", ...resto] = process.argv.slice(2);
const i = resto.indexOf("--abaixo-de");
const abaixoDe = i >= 0 ? Number(resto[i + 1]) : null;

const io = new NodeIO();
const doc = await io.read(entrada);
for (const m of doc.getRoot().listMeshes()) {
  for (const p of m.listPrimitives()) {
    for (const s of ["TEXCOORD_0", "NORMAL", "TANGENT", "COLOR_0"]) if (p.getAttribute(s)) p.setAttribute(s, null);
    p.setMaterial(null);
  }
}
doc.getRoot().listTextures().forEach((t) => t.dispose());
doc.getRoot().listMaterials().forEach((m) => m.dispose());
await MeshoptSimplifier.ready;
await doc.transform(weld({ tolerance: 0.0005 }), simplify({ simplifier: MeshoptSimplifier, ratio: Number(prop), error: 0.01 }), dedup(), prune());

if (abaixoDe != null) {
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute("POSITION").getArray();
      const idx = p.getIndices().getArray();
      const fica = [];
      for (let t = 0; t < idx.length; t += 3) {
        const y = (pos[idx[t] * 3 + 1] + pos[idx[t + 1] * 3 + 1] + pos[idx[t + 2] * 3 + 1]) / 3;
        if (y < abaixoDe) fica.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      p.getIndices().setArray(new Uint32Array(fica));
      compactPrimitive(p); // tira os vértices que ficaram sem uso
    }
  }
  await doc.transform(prune());
}

let tris = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
await io.write(saida, doc);
console.log(`${saida}: ${tris} triângulos`);
