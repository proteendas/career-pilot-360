import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/marketing/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The rules for using CareerPilot360, including what you remain responsible for.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="1 August 2026"
      intro={
        <p>
          These terms cover your use of CareerPilot360. The short version: the product prepares work, you decide what to
          send, and you remain responsible for the accuracy of anything that reaches an employer.
        </p>
      }
      sections={[
        {
          id: 'the-service',
          heading: 'What the service does',
          body: (
            <>
              <p>
                CareerPilot360 analyses your resume, discovers jobs from permitted sources, scores how well you match
                them, and prepares application material for your review. It is an assistant, not an agent acting on your
                behalf.
              </p>
              <p>
                Specifically, it does not submit applications to third-party websites, does not send messages on
                platforms like LinkedIn, and does not email anyone without a confirmation from you for that specific
                message.
              </p>
            </>
          ),
        },
        {
          id: 'your-responsibilities',
          heading: 'Your responsibilities',
          body: (
            <>
              <ul>
                <li>
                  <strong>Accuracy.</strong> Every claim in a resume or application you send is yours. The product
                  refuses to invent achievements, metrics or employers, but it cannot verify what you enter. Review
                  everything before it goes out.
                </li>
                <li>
                  <strong>Review of AI output.</strong> AI-generated text must be read by you before it is used in an
                  application or sent to another person. You accepted this when you created your account.
                </li>
                <li>
                  <strong>Third-party terms.</strong> When you open an employer’s portal or a job platform, you are
                  acting under their terms, in your own browser session. Those terms are between you and them.
                </li>
                <li>
                  <strong>Outreach conduct.</strong> Do not use the outreach assistant for bulk unsolicited email, and
                  honour any request to stop contacting someone. The product enforces daily caps, duplicate protection
                  and a suppression list, but the judgement is yours.
                </li>
                <li>
                  <strong>Your credentials.</strong> Keep your password and your AI provider keys to yourself. You are
                  responsible for activity under your account.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'prohibited',
          heading: 'What you may not do',
          body: (
            <ul>
              <li>
                Attempt to use CareerPilot360 to scrape, crawl or automate a third-party platform, or to circumvent any
                access control, rate limit or CAPTCHA.
              </li>
              <li>Upload someone else’s resume or personal data without their permission.</li>
              <li>Enter contact details you obtained by scraping or from a purchased contact database.</li>
              <li>Misrepresent your identity, experience, qualifications or authorisation to work.</li>
              <li>Attempt to reach other users’ data, or to probe the service for that purpose.</li>
              <li>Resell or redistribute the service without a separate agreement.</li>
            </ul>
          ),
        },
        {
          id: 'ai-providers',
          heading: 'AI providers and your keys',
          body: (
            <>
              <p>
                You supply your own API key for the AI provider of your choice. Your use of that provider is governed by
                their terms, and their pricing and free-tier availability are theirs to change. We make no promise that
                any provider will remain free or available.
              </p>
              <p>
                We encrypt your key at rest and use it only to perform tasks you initiate. You can remove it at any
                time, which deletes the stored ciphertext.
              </p>
            </>
          ),
        },
        {
          id: 'no-guarantees',
          heading: 'What we do not promise',
          body: (
            <>
              <ul>
                <li>
                  <strong>The ATS score is a heuristic.</strong> It is computed from documented, inspectable signals. It
                  is not the score any particular employer’s system will produce, and we do not claim otherwise.
                </li>
                <li>
                  <strong>Match scores are guidance.</strong> They reflect the information you gave us against the text
                  of a posting. They do not predict whether you will be interviewed or hired.
                </li>
                <li>
                  <strong>Job coverage is bounded.</strong> We search the sources listed on the{' '}
                  <Link href="/features">features page</Link> — not “the whole internet”.
                </li>
                <li>
                  <strong>No employment outcome is guaranteed.</strong> Nothing here is career, legal, immigration or tax
                  advice.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'availability',
          heading: 'Availability and changes',
          body: (
            <p>
              The service is provided as-is. Features may change, and third-party sources may become unavailable if a
              provider changes their terms — in which case we will disable the affected adapter rather than work around
              the restriction.
            </p>
          ),
        },
        {
          id: 'liability',
          heading: 'Liability',
          body: (
            <p>
              To the extent permitted by law, CareerPilot360 is not liable for indirect or consequential loss, including
              lost opportunities, arising from your use of the service. Nothing in these terms limits liability that
              cannot lawfully be limited.
            </p>
          ),
        },
        {
          id: 'termination',
          heading: 'Ending your use',
          body: (
            <p>
              You can delete your account at any time from <strong>Settings → Security &amp; privacy</strong>; see the{' '}
              <Link href="/privacy#data-deletion">deletion section</Link> for exactly what is removed. We may suspend an
              account that is being used for scraping, bulk unsolicited email, or misrepresentation.
            </p>
          ),
        },
        {
          id: 'contact',
          heading: 'Contact',
          body: (
            <p>
              <a href="mailto:legal@careerpilot360.example">legal@careerpilot360.example</a>. If you operate your own
              deployment, substitute your own contact details here.
            </p>
          ),
        },
      ]}
    />
  );
}
