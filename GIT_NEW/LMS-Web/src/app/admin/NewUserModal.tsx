"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { superAdminService } from "@/services/superAdminService";
import type { BranchOption, ScopeOption } from "@/services/superAdminService";

import { ScopePicker } from "./ScopePicker";

export function NewUserModal({
  companies,
  branches,
  onClose,
  onCreated,
}: {
  companies: ScopeOption[];
  branches: BranchOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [usrid, setUsrid] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [ecode, setEcode] = useState("");
  const [ulevl, setUlevl] = useState<"M" | "U">("M");
  const [selCompanies, setSelCompanies] = useState<string[]>([]);
  const [selBranches, setSelBranches] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!usrid.trim()) return setError("A user id is required");
    if (password.length < 6) return setError("The password must be at least 6 characters");
    if (!mobile.trim() && !ecode.trim()) {
      // Without one of these the account signs in but reaches no HR screen,
      // which looks like a broken app rather than a misconfigured user.
      return setError("Enter a mobile number or an employee code — HR access is matched on one of them");
    }
    setBusy(true);
    setError("");
    try {
      await superAdminService.createUser({
        usrid: usrid.trim().toUpperCase(),
        name: name.trim() || undefined,
        password,
        ulevl,
        mobile: mobile.trim() || undefined,
        ecode: ecode.trim() || undefined,
        companies: selCompanies,
        branches: selBranches,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New HR user"
      subtitle="Creates a SEC_USERNAME account and its company and branch access"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy}>Create user</Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert type="error" message={error} onClose={() => setError("")} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="User ID *"
            value={usrid}
            maxLength={2}
            onChange={(e) => setUsrid(e.target.value.toUpperCase())}
            placeholder="e.g. RK"
          />
          <Input
            label="Full name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="Shown across the HR screens"
          />
          <Input
            label="Password *"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
          />
          <Select
            label="Level"
            value={ulevl}
            onChange={(e) => setUlevl(e.target.value === "U" ? "U" : "M")}
            options={[
              { value: "M", label: "M — full rights" },
              { value: "U", label: "U — ordinary user" },
            ]}
          />
          <Input
            label="Mobile"
            value={mobile}
            inputMode="numeric"
            maxLength={11}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
            placeholder="3001234567"
          />
          <Input
            label="Employee code"
            value={ecode}
            onChange={(e) => setEcode(e.target.value)}
            placeholder="Links the account to an employee record"
          />
        </div>

        <p className="text-xs text-gray-500 -mt-1">
          The user ID is at most 2 characters. HR access is granted by matching
          the signed-in person&apos;s mobile number or employee code against this
          account, so at least one of those must be filled in.
        </p>

        <ScopePicker
          companies={companies}
          branches={branches}
          selectedCompanies={selCompanies}
          selectedBranches={selBranches}
          onCompaniesChange={setSelCompanies}
          onBranchesChange={setSelBranches}
        />
      </div>
    </Modal>
  );
}
