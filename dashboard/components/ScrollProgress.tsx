"use client";
import { motion, useScroll, useSpring } from "framer-motion";

/** 1px reading-progress bar pinned to the very top of the viewport. */
export default function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 200,
    damping: 40,
    restDelta: 0.001,
  });
  return (
    <motion.div
      style={{ scaleX }}
      className="fixed left-0 right-0 top-0 z-[55] h-0.5 origin-left bg-gradient-to-r from-neutral-500 via-neutral-200 to-neutral-500"
    />
  );
}
