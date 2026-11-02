import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Baby,
  BarChart3,
  Database,
  FileText,
  Lock,
  Mail,
  RefreshCw,
  Share2,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy | Sysnovix HRMS",
  description:
    "How Sysnovix collects, uses, discloses and protects your information in the Employee Portal, Leave Management and Attendance Tracking app.",
};

const LAST_UPDATED = "October 30, 2026";
const CONTACT_EMAIL = "info@sysnovix.com";

type Item = { label: string; text: string };

function ItemList({ items }: { items: Item[] }) {
  return (
    <ul className="mt-4 space-y-3">
      {items.map((it) => (
        <li key={it.label} className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          <p className="text-gray-600 leading-relaxed">
            <span className="font-semibold text-ink">{it.label}:</span> {it.text}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-line bg-white p-6 sm:p-8 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const sections = [
  { id: "introduction", title: "Introduction" },
  { id: "information-we-collect", title: "Information We Collect" },
  { id: "how-we-use", title: "How We Use Your Information" },
  { id: "sharing", title: "Sharing Your Information" },
  { id: "security", title: "Data Security" },
  { id: "your-rights", title: "Your Data Rights" },
  { id: "children", title: "Children's Privacy" },
  { id: "changes", title: "Changes to This Policy" },
  { id: "contact", title: "Contact Us" },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-brand" />
            <span className="text-lg font-bold text-ink">Sysnovix</span>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-brand transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-br from-[#0f1e46] via-[#1e3a8a] to-brand">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-blue-100 ring-1 ring-white/20">
            <Lock className="h-3.5 w-3.5" />
            Your privacy matters
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">Privacy Policy</h1>
          <p className="mt-4 max-w-2xl text-base text-blue-100 sm:text-lg">
            How Sysnovix handles your information in the Employee Portal, Leave Management System and
            Attendance Tracking app.
          </p>
          <p className="mt-6 text-sm text-blue-200">Last updated: {LAST_UPDATED}</p>
        </div>
      </div>

      {/* Body */}
      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 rounded-2xl border border-line bg-white p-4 shadow-sm">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">On this page</p>
            <ul className="space-y-0.5">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="block rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-brand-soft hover:text-brand transition-colors"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="space-y-6">
          <Section id="introduction" icon={FileText} title="Introduction">
            <p className="text-gray-600 leading-relaxed">
              Welcome to the Sysnovix Employee Portal, Leave Management System, and Attendance Tracking
              mobile application (the &quot;App&quot;). This Privacy Policy explains how Sysnovix (&quot;we&quot;,
              &quot;our&quot;, or &quot;us&quot;) collects, uses, discloses, and protects your information when
              you use our App. By using the App, you agree to the collection and use of information in
              accordance with this policy.
            </p>
          </Section>

          <Section id="information-we-collect" icon={Database} title="Information We Collect">
            <h3 className="font-semibold text-ink">Personal Information</h3>
            <p className="mt-1 text-gray-600">When you use our App, we may collect the following personal information:</p>
            <ItemList
              items={[
                { label: "Contact Information", text: "Name, email address, phone number." },
                { label: "Employment Information", text: "Employee ID, department, job title, work schedule." },
                { label: "Leave Information", text: "Types of leave, duration, reason for leave." },
                {
                  label: "Attendance Information",
                  text: "Check-in/check-out times, work hours, location data related to attendance.",
                },
              ]}
            />
            <h3 className="mt-6 font-semibold text-ink">Usage Data</h3>
            <p className="mt-1 text-gray-600">
              We may also collect information on how the App is accessed and used. This may include:
            </p>
            <ItemList
              items={[
                { label: "Device information", text: "Mobile device ID, operating system, and version." },
                { label: "Log data", text: "IP address, browser type, and access times." },
              ]}
            />
          </Section>

          <Section id="how-we-use" icon={BarChart3} title="How We Use Your Information">
            <p className="text-gray-600">We use the collected information for various purposes:</p>
            <ItemList
              items={[
                { label: "To provide and maintain the App", text: "Ensuring functionality and performance." },
                {
                  label: "To manage employee data",
                  text: "Tracking attendance, managing leave requests, and maintaining employee records.",
                },
                { label: "To communicate with you", text: "Sending notifications, updates, and support messages." },
                {
                  label: "To improve our services",
                  text: "Analyzing usage data to enhance the App's features and usability.",
                },
                { label: "To comply with legal obligations", text: "Meeting legal and regulatory requirements." },
              ]}
            />
          </Section>

          <Section id="sharing" icon={Share2} title="Sharing Your Information">
            <div className="rounded-xl bg-brand-soft px-4 py-3 text-sm font-medium text-ink">
              We do not sell or rent your personal information to third parties.
            </div>
            <p className="mt-4 text-gray-600">We may share your information in the following circumstances:</p>
            <ItemList
              items={[
                { label: "With your consent", text: "When you have given us explicit permission." },
                {
                  label: "With service providers",
                  text: "Third-party companies and individuals who assist us in operating the App and providing services to you, who are obligated not to disclose or use the information for any other purpose.",
                },
                { label: "For legal reasons", text: "If required by law or to protect our rights, property, or safety." },
              ]}
            />
          </Section>

          <Section id="security" icon={Lock} title="Data Security">
            <p className="text-gray-600 leading-relaxed">
              We take the security of your data seriously and implement appropriate technical and
              organizational measures to protect it. However, please be aware that no method of transmission
              over the internet or method of electronic storage is 100% secure and reliable.
            </p>
          </Section>

          <Section id="your-rights" icon={UserCheck} title="Your Data Rights">
            <p className="text-gray-600">
              Depending on your location, you may have the following rights regarding your personal information:
            </p>
            <ItemList
              items={[
                { label: "Access", text: "Request access to the personal information we hold about you." },
                { label: "Correction", text: "Request correction of inaccurate or incomplete information." },
                {
                  label: "Deletion",
                  text: "Request deletion of your personal information, subject to certain legal obligations.",
                },
                {
                  label: "Objection",
                  text: "Object to our processing of your personal information under certain conditions.",
                },
                {
                  label: "Data Portability",
                  text: "Request transfer of your personal information to another service provider.",
                },
              ]}
            />
            <p className="mt-4 text-gray-600">
              To exercise these rights, please contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-brand hover:underline">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section id="children" icon={Baby} title="Children's Privacy">
            <p className="text-gray-600 leading-relaxed">
              Our App is not intended for use by individuals under the age of 18. We do not knowingly collect
              personal information from children. If we become aware that we have inadvertently received
              personal information from a user under the age of 18, we will delete such information from our
              records.
            </p>
          </Section>

          <Section id="changes" icon={RefreshCw} title="Changes to This Privacy Policy">
            <p className="text-gray-600 leading-relaxed">
              We may update our Privacy Policy from time to time. We will notify you of any changes by posting
              the new Privacy Policy on this page. Changes are effective when they are posted on this page, and
              we encourage you to review this Privacy Policy periodically.
            </p>
          </Section>

          <section
            id="contact"
            className="scroll-mt-24 rounded-2xl bg-gradient-to-br from-[#0f1e46] to-brand p-6 text-white shadow-sm sm:p-8"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
                <Mail className="h-5 w-5" />
              </span>
              <h2 className="text-xl font-semibold">Contact Us</h2>
            </div>
            <p className="mt-4 text-blue-100">
              If you have any questions about this Privacy Policy, please contact us:
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-blue-50 transition-colors"
            >
              <Mail className="h-4 w-4 text-brand" />
              {CONTACT_EMAIL}
            </a>
          </section>

          <p className="px-1 text-sm leading-relaxed text-gray-500">
            By using our App, you agree to the terms of this Privacy Policy. If you do not agree with this
            policy, please do not use our App. Thank you for trusting Sysnovix with your information.
          </p>
        </div>
      </main>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-sm text-gray-500 sm:px-6">
          © {new Date().getFullYear()} Sysnovix. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
