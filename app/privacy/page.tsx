import React from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | PRFX",
  description: "Privacy Policy for Prefix Tree Limited",
};

const email = "partners@prefixtree.xyz";

const SubSectionHeader = ({ title }: { title: string }) => {
  return (
    <h3 className="text-left text-xl mb-3 font-semibold mt-6">
      {title}
    </h3>
  );
};

export default function PrivacyPolicy() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-12 pt-32 pb-8">
      <div className="mb-12">
        <h1
          className="text-left text-4xl mb-8 uppercase font-bold"
          style={{ letterSpacing: "0.08em" }}
        >
          Privacy Policy
        </h1>
        <p className="text-lg leading-relaxed">
          At Prefix Tree Limited (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;), we are committed to protecting and respecting your privacy. This Privacy Policy outlines how we collect, use, store, and protect your personal data when you interact with us — including through our website, services, and client communications.
        </p>
      </div>

      <div className="space-y-8">
        <section>
          <SubSectionHeader title="1. Information We Collect" />
          <p className="mb-4 leading-relaxed">
            We may collect and process the following types of information:
          </p>
          <ul className="list-disc ml-6 space-y-2">
            <li><strong>Personal Identification Information:</strong> Name, email address, phone number, job title, company name, etc.</li>
            <li><strong>Technical Data:</strong> IP address, browser type, operating system, and platform.</li>
            <li><strong>Cookies:</strong> Information collected via cookies and similar technologies when you visit our website. Please see our Cookie Policy for more details.</li>
          </ul>
        </section>

        <section>
          <SubSectionHeader title="2. How We Use Your Information" />
          <p className="mb-4 leading-relaxed">
            We use the data we collect for purposes including:
          </p>
          <ul className="list-disc ml-6 space-y-2 mb-4">
            <li><strong>Improving Our Website:</strong> Understanding user behavior to optimize performance and design.</li>
            <li><strong>Communication:</strong> Responding to inquiries, providing service updates, and offering support.</li>
            <li><strong>Marketing:</strong> With your consent, sending occasional updates and insights about our services. You can opt out at any time.</li>
          </ul>
          <p className="leading-relaxed">
            When you visit or log in to our site, cookies and similar technologies may be used by us or our data partners to associate your activity with additional information (e.g., email or postal address). This data may be used to send relevant communications or marketing. You may opt out of this by visiting: <a href="https://app.retention.com/optout" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">https://app.retention.com/optout</a>
          </p>
        </section>

        <section>
          <SubSectionHeader title="3. Legal Basis for Processing" />
          <p className="mb-4 leading-relaxed">
            We process your personal data under the following legal bases:
          </p>
          <ul className="list-disc ml-6 space-y-2">
            <li><strong>Legitimate Interest:</strong> For delivering and improving our services.</li>
            <li><strong>Consent:</strong> For marketing activities and non-essential cookies.</li>
            <li><strong>Legal Obligation:</strong> To comply with applicable laws and regulations.</li>
          </ul>
        </section>

        <section>
          <SubSectionHeader title="4. Data Sharing and Disclosure" />
          <p className="mb-4 leading-relaxed">
            We do not sell your data. However, we may share it in the following circumstances:
          </p>
          <ul className="list-disc ml-6 space-y-2">
            <li><strong>Trusted Service Providers:</strong> We may work with third-party vendors (e.g., cloud hosting, analytics) who are bound by confidentiality.</li>
            <li><strong>Legal Requirements:</strong> We may disclose data where required by law or to protect our rights or safety.</li>
          </ul>
        </section>

        <section>
          <SubSectionHeader title="5. Data Retention" />
          <p className="leading-relaxed">
            We retain your personal data only as long as necessary for the purposes it was collected, including legal, tax, and compliance obligations. Typically, this is up to 3 years, unless a longer period is required.
          </p>
        </section>

        <section>
          <SubSectionHeader title="6. Data Security" />
          <p className="leading-relaxed">
            We implement technical and organizational measures to protect your data from unauthorized access, loss, or misuse — including encrypted connections, access restrictions, and secure storage. However, no internet transmission is ever 100% secure.
          </p>
        </section>

        <section>
          <SubSectionHeader title="7. Your Data Protection Rights" />
          <p className="mb-4 leading-relaxed">
            Under the UK GDPR and relevant EU laws, you have the right to:
          </p>
          <ul className="list-disc ml-6 space-y-2 mb-4">
            <li>Access your data</li>
            <li>Correct inaccurate or incomplete data</li>
            <li>Delete your data (with some legal exceptions)</li>
            <li>Restrict processing under specific circumstances</li>
            <li>Object to processing for marketing or legitimate interest</li>
            <li>Port your data in a structured, machine-readable format</li>
          </ul>
          <p className="leading-relaxed">
            To exercise these rights, contact us using the details below.
          </p>
        </section>

        <section>
          <SubSectionHeader title="8. International Data Transfers" />
          <p className="leading-relaxed">
            We may process or store data outside the UK or EEA. Where we do, we implement appropriate safeguards, such as Standard Contractual Clauses approved by the European Commission.
          </p>
        </section>

        <section>
          <SubSectionHeader title="9. Changes to This Policy" />
          <p className="leading-relaxed">
            We may update this Privacy Policy to reflect changes in law, technology, or our operations. Any updates will be posted on our website with a revised &ldquo;last updated&rdquo; date.
          </p>
        </section>

        <section>
          <SubSectionHeader title="10. Contact Us" />
          <p className="mb-4 leading-relaxed">
            If you have any questions about this Privacy Policy or how we handle your data, please contact:
          </p>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="font-semibold">Prefix Tree Limited</p>
            <p>Email: <a href={`mailto:${email}`} className="text-blue-600 hover:underline">{email}</a></p>
          </div>
        </section>
      </div>

      <div className="mt-12 pt-8 border-t border-gray-200">
        <p className="text-sm text-gray-600 text-center">
          Last updated: July 3, 2025
        </p>
      </div>
    </div>
  );
}
