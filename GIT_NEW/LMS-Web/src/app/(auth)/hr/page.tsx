"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useHRController } from "@/controllers/useHRController";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Users, Search, UserCheck, UserX } from "lucide-react";

export default function HRAdminPage() {
  const { user } = useAuth();
  const { employees, loading, error, search } = useHRController();
  const [query, setQuery] = useState("");

  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 mt-2">You don't have HR admin privileges.</p>
        </div>
      </div>
    );
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    search(query);
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="HR Administration"
        subtitle="Search and manage employee records"
      />

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <form onSubmit={onSearch} className="flex gap-3">
            <div className="flex-1">
              <Input
                placeholder="Search by name, phone, card number, or employee code..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button type="submit" loading={loading}>
              <Search className="h-4 w-4 mr-1.5" />
              Search
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 bg-red-50 text-red-800 px-4 py-3 rounded-xl text-sm border border-red-200">
          {error}
        </div>
      )}

      {/* Results */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Employee Directory</h2>
            {employees.length > 0 && (
              <span className="text-sm text-gray-400">({employees.length} results)</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <Spinner />
          ) : employees.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Search for employees to see results</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Employee</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Code</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Department</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Designation</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Mobile</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Face</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {employees.map((emp, i) => (
                    <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-linear-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                            {emp.emp_name?.charAt(0) || "?"}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{emp.emp_name}</p>
                            <p className="text-xs text-gray-400">Card: {emp.card_no}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{emp.empcode}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{emp.department}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{emp.designation}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{emp.mobile_no}</td>
                      <td className="px-6 py-4">
                        {emp.face_registered ? (
                          <span className="flex items-center gap-1 text-emerald-600 text-sm">
                            <UserCheck className="h-4 w-4" /> Registered
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-gray-400 text-sm">
                            <UserX className="h-4 w-4" /> Not Registered
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
