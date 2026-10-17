"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ease, facingRotation, gibsGlobeUrl, latLonToVector3, lerp, markerHeight, range } from "@/lib/landing/globe-math";

export interface GlobeMarker {
  code: string;
  name: string;
  lat: number;
  lon: number;
  active: number;
  color: string;
}

export type ImageryStatus = "loading" | "live" | "base" | "none";

interface Props {
  markers: GlobeMarker[];
  /** Scroll progress of the hero, 0–1. Read every frame, so it never re-renders React. */
  getProgress: () => number;
  /** Yesterday's UTC date (YYYY-MM-DD) for the VIIRS pass. */
  passDate: string;
  reducedMotion: boolean;
  onImagery?: (s: ImageryStatus) => void;
  className?: string;
}

const INDIA = { lat: 22.5, lon: 80.5 };

const EARTH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const EARTH_FRAG = /* glsl */ `
uniform sampler2D uDay;
uniform sampler2D uPass;
uniform sampler2D uNight;
uniform float uHasDay;
uniform float uHasPass;
uniform float uHasNight;
uniform vec3 uSun;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);

  // Fallback surface: deep ocean with a fine graticule, used until imagery arrives.
  vec2 g = abs(fract(vUv * vec2(36.0, 18.0)) - 0.5);
  float grid = 1.0 - smoothstep(0.0, 0.03, min(g.x, g.y));
  vec3 base = mix(vec3(0.03, 0.07, 0.11), vec3(0.12, 0.24, 0.3), grid * 0.6);

  vec3 day = mix(base, texture2D(uDay, vUv).rgb, uHasDay);
  // Yesterday's real VIIRS pass: lighten-blend so clouds show and orbit gaps fall back to Blue Marble.
  day = mix(day, max(day, texture2D(uPass, vUv).rgb), uHasPass);

  float lambert = dot(n, normalize(uSun));
  float dayMix = smoothstep(-0.18, 0.32, lambert);
  vec3 lit = day * (0.18 + 1.05 * max(lambert, 0.0));

  vec3 lights = texture2D(uNight, vUv).rgb * vec3(1.0, 0.72, 0.42) * 1.8 * uHasNight;
  vec3 night = base * 0.25 + lights;
  vec3 color = mix(night, lit, dayMix);

  // Specular glint on the ocean (dark pixels) on the sunlit side.
  float ocean = 1.0 - smoothstep(0.08, 0.22, dot(day, vec3(0.333)));
  vec3 h = normalize(normalize(uSun) + v);
  color += vec3(0.55, 0.7, 0.9) * pow(max(dot(n, h), 0.0), 60.0) * ocean * 0.6 * dayMix;

  // Thin atmosphere rim.
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  color += vec3(0.32, 0.62, 1.0) * rim * (0.25 + 0.75 * dayMix) * 0.9;

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uSun;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);
  // Back faces: -dot(n, v) is ~0.5 at the planet's edge and 0 at the outer shell.
  float i = pow(clamp(-dot(n, v) * 1.9, 0.0, 1.0), 3.0);
  float sun = 0.35 + 0.65 * smoothstep(-0.4, 0.6, dot(n, normalize(uSun)));
  gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * i * sun, i * 0.9);
  #include <colorspace_fragment>
}`;

/** Draws the live-alert globe. Purely presentational: every marker comes from props. */
export default function EarthGlobe({ markers, getProgress, passDate, reducedMotion, onImagery, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const kickRef = useRef<() => void>(() => {});
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const progressRef = useRef(getProgress);
  progressRef.current = getProgress;
  const onImageryRef = useRef(onImagery);
  onImageryRef.current = onImagery;

  // ── Scene setup (once) ────────────────────────────────────────────────────
  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      onImageryRef.current?.("none");
      return;
    }
    const small = window.matchMedia("(max-width: 767px)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
    camera.position.set(0, 0, 4.2);

    // tilt (X) → spin (Y) → earth + markers
    const tilt = new THREE.Group();
    const spin = new THREE.Group();
    tilt.add(spin);
    scene.add(tilt);

    const sun = new THREE.Vector3(-0.7, 0.45, 0.9).normalize();
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blank.needsUpdate = true;

    const earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: {
        uDay: { value: blank },
        uPass: { value: blank },
        uNight: { value: blank },
        uHasDay: { value: 0 },
        uHasPass: { value: 0 },
        uHasNight: { value: 0 },
        uSun: { value: sun },
      },
    });
    const earthGeo = new THREE.SphereGeometry(1, small ? 96 : 160, small ? 64 : 120);
    const earth = new THREE.Mesh(earthGeo, earthMat);
    spin.add(earth);

    const atmoMat = new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: { uSun: { value: sun } },
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const atmoGeo = new THREE.SphereGeometry(1.16, 64, 48);
    const atmo = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmo);

    const markerGroup = new THREE.Group();
    spin.add(markerGroup);
    markerGroupRef.current = markerGroup;
    buildMarkers(markerGroup, markersRef.current);

    // Background stars: decorative only.
    const starCount = small ? 700 : 1600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 20;
      const s = Math.sqrt(1 - u * u);
      starPos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xcfe3ff, size: small ? 1.1 : 1.3, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // ── Real imagery from NASA GIBS ──────────────────────────────────────────
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const maxTex = Math.min(renderer.capabilities.maxTextureSize, small ? 2048 : 4096);
    const textures: THREE.Texture[] = [];
    let disposed = false;
    let gotDay = false;
    let gotPass = false;
    let pending = 3;
    const report = () => {
      if (disposed) return;
      if (pending > 0) onImageryRef.current?.(gotDay || gotPass ? (gotPass ? "live" : "base") : "loading");
      else onImageryRef.current?.(gotPass ? "live" : gotDay ? "base" : "none");
    };
    const load = (urlFor: (w: number) => string, width: number, uniform: "uDay" | "uPass" | "uNight", flag: "uHasDay" | "uHasPass" | "uHasNight") => {
      loader.load(
        urlFor(width),
        (tex) => {
          if (disposed) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          tex.wrapS = THREE.RepeatWrapping;
          textures.push(tex);
          earthMat.uniforms[uniform]!.value = tex;
          earthMat.uniforms[flag]!.value = 1;
          if (uniform === "uDay") gotDay = true;
          if (uniform === "uPass") gotPass = true;
          pending--;
          report();
          kick();
        },
        undefined,
        () => {
          if (disposed) return;
          // Retry once at half size before giving up on this layer.
          if (width > 1024) return load(urlFor, width / 2, uniform, flag);
          pending--;
          report();
        },
      );
    };
    report();
    load((w) => gibsGlobeUrl("BlueMarble_NextGeneration", w), maxTex, "uDay", "uHasDay");
    load((w) => gibsGlobeUrl("VIIRS_SNPP_CorrectedReflectance_TrueColor", w, passDate), maxTex, "uPass", "uHasPass");
    load((w) => gibsGlobeUrl("VIIRS_CityLights_2012", w), Math.min(maxTex, 2048), "uNight", "uHasNight");

    // ── Pointer parallax (fine pointers only) ────────────────────────────────
    const pointer = { x: 0, y: 0 };
    const fine = window.matchMedia("(pointer: fine)").matches && !reducedMotion;
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (fine) window.addEventListener("pointermove", onMove, { passive: true });

    // ── Size ─────────────────────────────────────────────────────────────────
    let wide = true;
    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      wide = w >= 768;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      kick();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // ── Loop: paused off-screen and in background tabs ───────────────────────
    const face = facingRotation(INDIA.lat, INDIA.lon);
    const cur = { spin: face.y + 0.9, tilt: face.x * 0.5, z: 4.2, x: 0.6, y: 0 };
    let visible = true;
    let raf = 0;
    const t0 = performance.now();
    // In reduced-motion mode the scene is drawn on demand (imagery, markers, resize), not every frame.
    let still = 0;
    function kick() {
      still = 0;
      if (!raf && visible && !disposed) raf = requestAnimationFrame(frame);
    }
    kickRef.current = kick;
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(el);

    function frame() {
      raf = 0;
      if (!visible || document.hidden) return;
      const t = (performance.now() - t0) / 1000;
      const p = reducedMotion ? 0.35 : progressRef.current();

      // Story: wide globe beside the headline → swing to India → close over the subcontinent.
      const swing = ease(range(p, 0, 0.55));
      const close = ease(range(p, 0.35, 0.95));
      const idle = reducedMotion ? 0 : Math.sin(t * 0.12) * 0.35 * (1 - swing);
      const target = {
        spin: lerp(face.y + 1.1, face.y, swing) + idle + (fine ? pointer.x * 0.08 : 0),
        tilt: lerp(face.x * 0.45, face.x, swing) + (fine ? pointer.y * 0.05 : 0),
        z: lerp(wide ? 4.0 : 4.8, wide ? 1.85 : 2.3, close),
        x: wide ? lerp(0.62, 0, ease(range(p, 0.05, 0.5))) : 0,
        y: wide ? 0 : lerp(-0.35, 0, ease(range(p, 0.05, 0.5))),
      };
      const k = reducedMotion ? 1 : 0.075;
      cur.spin += (target.spin - cur.spin) * k;
      cur.tilt += (target.tilt - cur.tilt) * k;
      cur.z += (target.z - cur.z) * k;
      cur.x += (target.x - cur.x) * k;
      cur.y += (target.y - cur.y) * k;

      spin.rotation.y = cur.spin;
      tilt.rotation.x = cur.tilt;
      tilt.position.set(cur.x, cur.y, 0);
      atmo.position.copy(tilt.position);
      camera.position.set(0, 0, cur.z);
      camera.lookAt(0, 0, 0);
      stars.rotation.y = t * 0.004;

      // Pulse rings outward from each live marker.
      for (const child of markerGroup.children) {
        const ring = child.userData.ring as THREE.Mesh | undefined;
        if (!ring) continue;
        const phase = reducedMotion ? 0.4 : ((t * 0.55 + (child.userData.offset as number)) % 1);
        ring.scale.setScalar(1 + phase * 2.6);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - phase);
      }

      renderer.render(scene, camera);
      // Reduced motion: a few frames let the camera settle, then stop until kicked.
      if (!reducedMotion || ++still < 3) raf = requestAnimationFrame(frame);
    }
    const onVis = () => {
      if (!document.hidden && visible && !raf) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVis);
    resize();
    kick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      disposeMarkers(markerGroup);
      markerGroupRef.current = null;
      kickRef.current = () => {};
      for (const tex of textures) tex.dispose();
      blank.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [passDate, reducedMotion]);

  // ── Live markers: rebuilt whenever the official feed changes ───────────────
  useEffect(() => {
    const group = markerGroupRef.current;
    if (!group) return;
    buildMarkers(group, markers);
    kickRef.current();
  }, [markers]);

  return <div ref={host} className={className} />;
}

function buildMarkers(group: THREE.Group, markers: GlobeMarker[]) {
  disposeMarkers(group);
  const up = new THREE.Vector3(0, 1, 0);
  markers.forEach((m, i) => {
    const h = markerHeight(m.active);
    if (h <= 0) return;
    const pos = latLonToVector3(m.lat, m.lon, 1);
    const normal = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    const color = new THREE.Color(m.color);
    const holder = new THREE.Group();
    holder.position.copy(normal);
    holder.quaternion.setFromUnitVectors(up, normal);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0045, 0.0085, h, 10, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    beam.position.y = h / 2;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 8), new THREE.MeshBasicMaterial({ color }));
    cap.position.y = h;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.014, 0.019, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    holder.add(beam, cap, ring);
    holder.userData = { ring, offset: (i * 0.137) % 1, code: m.code };
    group.add(holder);
  });
}

function disposeMarkers(group: THREE.Group) {
  for (const holder of [...group.children]) {
    holder.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    });
    group.remove(holder);
  }
}