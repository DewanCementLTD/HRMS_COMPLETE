"use client";

import { useState, FormEvent, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthController } from "@/controllers/useAuthController";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import Image from "next/image";
import { Lock, User } from "lucide-react";

const REMEMBER_KEY = "lms_remember";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const { handleLogin, loading, error } = useAuthController();
  const { user, isLoading } = useAuth();
  const router = useRouter();

  // Restore saved credentials on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        const { username: u, password: p } = JSON.parse(saved);
        if (u) setUsername(u);
        if (p) setPassword(p);
        setRememberMe(true);
      }
    } catch {
      // ignore corrupt data
    }
  }, []);

  useEffect(() => {
    if (!isLoading && user) {
      router.push("/dashboard");
    }
  }, [user, isLoading, router]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (username && password) {
      // Save or clear credentials based on remember me
      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username, password }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
      handleLogin(username, password);
    }
  }

  if (isLoading) return null;
  if (user) return null;

  return (
    <div className="min-h-screen flex relative">
      {/* Full-page background */}
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/background.png')" }}
      />
      <div className="fixed inset-0 bg-gray-900/75" />

      {/* Left panel - branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="flex items-center gap-4 mb-8">
            <Image src="/YDC-HD.png" alt="LMS Logo" width={64} height={64} />
            <h1 className="text-3xl font-bold">LMS Portal</h1>
          </div>
          <h2 className="text-4xl font-bold leading-tight mb-4">
            Leave & Attendance<br />Management System
          </h2>
          <p className="text-lg text-gray-300 max-w-md">
            Manage your leaves, track attendance, and stay updated with your
            work schedule — all in one place.
          </p>
          <div className="mt-12 grid grid-cols-3 gap-6">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold">500+</p>
              <p className="text-xs text-gray-300 mt-1">Employees</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold">24/7</p>
              <p className="text-xs text-gray-300 mt-1">Access</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold">Real-time</p>
              <p className="text-xs text-gray-300 mt-1">Tracking</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel - login form */}
      <div className="flex-1 flex items-center justify-center p-8 relative z-10">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <Image src="/YDC-HD.png" alt="LMS Logo" width={48} height={48} />
            <h1 className="text-2xl font-bold text-white">LMS Portal</h1>
          </div>

          <div className="animate-fade-in bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
            <h2 className="text-2xl font-bold text-white">Welcome back</h2>
            <p className="text-gray-300 mt-2 mb-8">Sign in to your account to continue</p>

            {error && (
              <div className="mb-6">
                <Alert type="error" message={error} />
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-5">
              <div className="relative">
                <User className="absolute left-3 top-9.5 h-5 w-5 text-gray-400" />
                <Input
                  label="Employee ID / Phone"
                  labelClassName="text-gray-200"
                  placeholder="Enter your ID or phone number"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-gray-400"
                  required
                />
              </div>

              <div className="relative">
                <Lock className="absolute left-3 top-9.5 h-5 w-5 text-gray-400" />
                <Input
                  label="Password"
                  labelClassName="text-gray-200"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-gray-400"
                  required
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => {
                    setRememberMe(e.target.checked);
                    if (!e.target.checked) {
                      localStorage.removeItem(REMEMBER_KEY);
                    }
                  }}
                  className="h-4 w-4 rounded border-white/30 bg-white/10 text-indigo-500 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-300">Remember me</span>
              </label>

              <Button type="submit" loading={loading} className="w-full" size="lg">
                Sign In
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
