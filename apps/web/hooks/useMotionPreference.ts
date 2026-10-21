"use client";
import { createContext, useContext } from "react";

export const MotionPreferenceContext = createContext(false);
export const useMotionPreference = () => useContext(MotionPreferenceContext);
