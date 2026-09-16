import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { collections, credentials, itemRevisions, items, users } from "../src/db/schema";
import type { ItemType, PageDetail } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { encryptSecret } from "../src/lib/credentialCrypto";
import { serverImage } from "../src/lib/images";

const DEMO_PASSWORD = "NimbusDemo!2024";

function agoDate(spec: string): Date {
  const m = spec.match(/^(\d+)\s+(year|month|week|day)s?\s+ago$/);
  if (!m) throw new Error(`Unrecognized date spec: "${spec}"`);
  const amount = Number(m[1]);
  const msPerUnit: Record<string, number> = {
    year: 1000 * 60 * 60 * 24 * 365,
    month: 1000 * 60 * 60 * 24 * 30,
    week: 1000 * 60 * 60 * 24 * 7,
    day: 1000 * 60 * 60 * 24,
  };
  return new Date(Date.now() - amount * msPerUnit[m[2]]);
}

const img = (seed: string) => serverImage(seed, 900, 500);

interface ChangeSpec {
  field: string;
  from: string;
  to: string;
  category?: string;
}

interface RevisionSpec {
  revision: number;
  ago: string;
  author: string;
  summary: string;
  changes: ChangeSpec[];
}

interface ItemSpec {
  slug: string;
  title: string;
  type: ItemType;
  region: string | null;
  baseDetails: PageDetail[];
  image: string | null;
  warning?: string;
  inSection: boolean;
  revisions: RevisionSpec[];
}

function applyChanges(details: PageDetail[], changes: ChangeSpec[]): PageDetail[] {
  const list = [...details];
  for (const c of changes) {
    const idx = list.findIndex((d) => d.label === c.field);
    if (idx >= 0) {
      list[idx] = { ...list[idx], value: c.to };
    } else {
      list.push({ category: c.category ?? "Operations", label: c.field, value: c.to });
    }
  }
  return list;
}

const servers: ItemSpec[] = [
  {
    slug: "prod-aws-stonehawk",
    title: "prod-aws-stonehawk",
    type: "server",
    region: "AWS us-east-1",
    image: img("stonehawk-datacenter"),
    inSection: true,
    warning:
      "DO NOT RESTART THIS MACHINE!!! Barry didn't assign a proper IP so AWS will re-allocate upon restart. This is production critical!",
    baseDetails: [
      { category: "Compute", label: "Environment", value: "AWS" },
      { category: "Compute", label: "Region", value: "us-east-1 (N. Virginia)" },
      { category: "Compute", label: "IP", value: "192.168.1.1" },
      { category: "Compute", label: "Instance Size", value: "T2-Micro" },
      { category: "Compute", label: "RAM", value: "0.5GB + 4GB Swap" },
      { category: "Compute", label: "CPU", value: "1vcpu" },
      { category: "Compute", label: "Operating System", value: "Amazon Linux 2023" },
      { category: "Compute", label: "Traffic", value: "Pay-per-GB (AWS Data Transfer Out pricing)" },
      { category: "Storage & Backup", label: "Storage", value: "10GB" },
      { category: "Storage & Backup", label: "Storage Role", value: "Customer object storage — hot tier" },
      { category: "Storage & Backup", label: "Customer Data Hosted", value: "~4.2TB (encrypted at rest)" },
      { category: "Storage & Backup", label: "Backup", value: "Every 6 hours, 30-day retention" },
      { category: "Operations", label: "Uptime (90d)", value: "99.95%" },
    ],
    revisions: [
      { revision: 1, ago: "4 years ago", author: "barry", summary: "Initial page created.", changes: [] },
      {
        revision: 2,
        ago: "5 days ago",
        author: "barry",
        summary: "Documented root cause of the IP re-allocation risk so nobody restarts this box by accident.",
        changes: [
          {
            field: "Admin Console",
            from: "(not documented)",
            to: "https://console.aws.amazon.com/ec2 — account nimbusvault-prod, no SSO yet",
            category: "Operations",
          },
        ],
      },
    ],
  },
  {
    slug: "prod-linode-sparkjet",
    title: "prod-linode-sparkjet",
    type: "server",
    region: "Linode eu-west",
    image: img("sparkjet-servers"),
    inSection: true,
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Linode" },
      { category: "Compute", label: "Region", value: "eu-west (London)" },
      { category: "Compute", label: "IP", value: "192.168.1.2" },
      { category: "Compute", label: "Instance Size", value: "Linode 4GB" },
      { category: "Compute", label: "RAM", value: "4GB" },
      { category: "Compute", label: "CPU", value: "2vcpu" },
      { category: "Compute", label: "Operating System", value: "Ubuntu 22.04 LTS" },
      { category: "Compute", label: "Traffic", value: "5TB/mo included (Linode plan allowance)" },
      { category: "Storage & Backup", label: "Storage", value: "80GB" },
      { category: "Storage & Backup", label: "Storage Role", value: "Customer object storage — warm tier" },
      { category: "Storage & Backup", label: "Customer Data Hosted", value: "~11.8TB (encrypted at rest)" },
      { category: "Storage & Backup", label: "Backup", value: "Nightly, 30-day retention" },
      { category: "Operations", label: "Uptime (90d)", value: "99.98%" },
    ],
    revisions: [
      { revision: 1, ago: "3 years ago", author: "barry", summary: "Initial page created.", changes: [] },
      {
        revision: 2,
        ago: "1 year ago",
        author: "barry",
        summary: "Upgraded instance size after a customer traffic spike.",
        changes: [
          { field: "Instance Size", from: "Linode 2GB", to: "Linode 4GB" },
          { field: "RAM", from: "2GB", to: "4GB" },
        ],
      },
      {
        revision: 3,
        ago: "3 months ago",
        author: "priya",
        summary: "Extended backup retention window for compliance.",
        changes: [{ field: "Backup", from: "Nightly, 30-day retention", to: "Nightly, 60-day retention" }],
      },
    ],
  },
  {
    slug: "dev-internal-sparklebike",
    title: "dev-internal-sparklebike",
    type: "server",
    region: "Internal / On-Prem",
    image: img("sparklebike-rack"),
    inSection: true,
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Internal / On-Prem" },
      { category: "Compute", label: "Region", value: "Austin, TX (HQ)" },
      { category: "Compute", label: "IP", value: "10.0.0.14" },
      { category: "Compute", label: "Instance Size", value: "Custom Tower" },
      { category: "Compute", label: "RAM", value: "16GB" },
      { category: "Compute", label: "CPU", value: "4vcpu" },
      { category: "Compute", label: "Operating System", value: "Ubuntu 22.04 LTS" },
      { category: "Compute", label: "Traffic", value: "Unmetered (internal network)" },
      { category: "Storage & Backup", label: "Storage", value: "500GB" },
      { category: "Storage & Backup", label: "Storage Role", value: "Internal staging & QA sandbox" },
      { category: "Storage & Backup", label: "Customer Data Hosted", value: "None — synthetic test data only" },
      { category: "Storage & Backup", label: "Backup", value: "Weekly, 14-day retention" },
      { category: "Operations", label: "Uptime (90d)", value: "97.10%" },
    ],
    revisions: [
      { revision: 1, ago: "2 years ago", author: "barry", summary: "Initial page created.", changes: [] },
      {
        revision: 2,
        ago: "20 months ago",
        author: "barry",
        summary: "Bumped memory for larger QA load tests.",
        changes: [{ field: "RAM", from: "8GB", to: "16GB" }],
      },
      {
        revision: 3,
        ago: "14 months ago",
        author: "marcus",
        summary: "Migrated to a larger local volume.",
        changes: [{ field: "Storage", from: "250GB", to: "500GB" }],
      },
      {
        revision: 4,
        ago: "9 months ago",
        author: "marcus",
        summary: "Reclassified box now that it's used exclusively for staging.",
        changes: [{ field: "Storage Role", from: "General purpose test box", to: "Internal staging & QA sandbox" }],
      },
      {
        revision: 5,
        ago: "5 months ago",
        author: "marcus",
        summary: "Relaxed backup schedule — this box holds no real customer data.",
        changes: [{ field: "Backup", from: "Daily, 7-day retention", to: "Weekly, 14-day retention" }],
      },
    ],
  },
  {
    slug: "prod-gcp-glacierfox",
    title: "prod-gcp-glacierfox",
    type: "server",
    region: "GCP europe-west1",
    image: img("glacierfox-datacenter"),
    inSection: true,
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Google Cloud Platform" },
      { category: "Compute", label: "Region", value: "europe-west1 (Belgium)" },
      { category: "Compute", label: "IP", value: "10.42.0.7" },
      { category: "Compute", label: "Instance Size", value: "n2-standard-8" },
      { category: "Compute", label: "RAM", value: "32GB" },
      { category: "Compute", label: "CPU", value: "8vcpu" },
      { category: "Compute", label: "Operating System", value: "Debian 12 (GCP default image)" },
      { category: "Compute", label: "Traffic", value: "Pay-per-GB (GCP egress pricing)" },
      { category: "Storage & Backup", label: "Storage", value: "2TB SSD" },
      { category: "Storage & Backup", label: "Storage Role", value: "Cold storage archive tier" },
      { category: "Storage & Backup", label: "Customer Data Hosted", value: "~64.3TB (encrypted at rest)" },
      { category: "Storage & Backup", label: "Backup", value: "Continuous replication, geo-redundant" },
      { category: "Operations", label: "Uptime (90d)", value: "99.99%" },
    ],
    revisions: [
      { revision: 1, ago: "2 years ago", author: "priya", summary: "Initial page created.", changes: [] },
      {
        revision: 2,
        ago: "14 months ago",
        author: "priya",
        summary: "Resized node to handle growing archive tier volume.",
        changes: [
          { field: "Instance Size", from: "n2-standard-4", to: "n2-standard-8" },
          { field: "RAM", from: "16GB", to: "32GB" },
        ],
      },
      {
        revision: 3,
        ago: "5 months ago",
        author: "priya",
        summary: "Expanded attached SSD ahead of a large cold-tier migration.",
        changes: [{ field: "Storage", from: "1TB SSD", to: "2TB SSD" }],
      },
      {
        revision: 4,
        ago: "1 month ago",
        author: "priya",
        summary: "Switched to continuous geo-redundant replication.",
        changes: [
          { field: "Backup", from: "Nightly, 90-day retention", to: "Continuous replication, geo-redundant" },
        ],
      },
      {
        revision: 5,
        ago: "6 days ago",
        author: "priya",
        summary: "Added on-call escalation contact after a slow SEV-3 response last week.",
        changes: [
          {
            field: "On-call Contact",
            from: "(not documented)",
            to: "#infra-oncall Slack, PagerDuty \"Storage-Prod\" schedule",
            category: "Operations",
          },
        ],
      },
    ],
  },
  {
    slug: "prod-azure-thornwake",
    title: "prod-azure-thornwake",
    type: "server",
    region: "Azure westeurope",
    image: img("thornwake-server-room"),
    inSection: true,
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Microsoft Azure" },
      { category: "Compute", label: "Region", value: "westeurope (Netherlands)" },
      { category: "Compute", label: "IP", value: "10.1.4.22" },
      { category: "Compute", label: "Instance Size", value: "Standard_D4s_v5" },
      { category: "Compute", label: "RAM", value: "16GB" },
      { category: "Compute", label: "CPU", value: "4vcpu" },
      { category: "Compute", label: "Operating System", value: "Ubuntu 22.04 LTS" },
      { category: "Compute", label: "Traffic", value: "Pay-per-GB (Azure outbound data transfer pricing)" },
      { category: "Storage & Backup", label: "Storage", value: "1TB Premium SSD" },
      { category: "Storage & Backup", label: "Storage Role", value: "Customer object storage — hot tier" },
      { category: "Storage & Backup", label: "Customer Data Hosted", value: "~22.6TB (encrypted at rest)" },
      { category: "Storage & Backup", label: "Backup", value: "Every 6 hours, 30-day retention" },
      { category: "Operations", label: "Uptime (90d)", value: "99.92%" },
    ],
    revisions: [
      { revision: 1, ago: "1 year ago", author: "marcus", summary: "Initial page created.", changes: [] },
      {
        revision: 2,
        ago: "8 months ago",
        author: "marcus",
        summary: "Resized node from D2s_v5 to D4s_v5 to absorb more customer traffic.",
        changes: [
          { field: "RAM", from: "8GB", to: "16GB" },
          { field: "CPU", from: "2vcpu", to: "4vcpu" },
        ],
      },
      {
        revision: 3,
        ago: "2 months ago",
        author: "marcus",
        summary: "Promoted node from provisioning to serving live customer storage.",
        changes: [
          { field: "Storage Role", from: "Provisioning — not yet serving traffic", to: "Customer object storage — hot tier" },
        ],
      },
      {
        revision: 4,
        ago: "2 weeks ago",
        author: "marcus",
        summary: "Tightened backup window to match hot-tier SLA.",
        changes: [{ field: "Backup", from: "Daily, 14-day retention", to: "Every 6 hours, 30-day retention" }],
      },
    ],
  },
  {
    slug: "dr-onprem-ironvault",
    title: "dr-onprem-ironvault",
    type: "server",
    region: "Internal / DR Site",
    image: img("ironvault-dr-site"),
    inSection: true,
    warning:
      "Failover target for all production storage nodes. Coordinate with the Infrastructure on-call lead before running any DR drills against this host.",
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Internal / On-Prem" },
      { category: "Compute", label: "Region", value: "Reno, NV (DR Site)" },
      { category: "Compute", label: "IP", value: "10.9.0.3" },
      { category: "Compute", label: "Instance Size", value: "Dell PowerEdge R760" },
      { category: "Compute", label: "RAM", value: "256GB" },
      { category: "Compute", label: "CPU", value: "32vcpu" },
      { category: "Compute", label: "Operating System", value: "Ubuntu 22.04 LTS" },
      { category: "Compute", label: "Traffic", value: "Unmetered (internal DR link)" },
      { category: "Storage & Backup", label: "Storage", value: "40TB RAID 6" },
      { category: "Storage & Backup", label: "Storage Role", value: "Disaster recovery cold replica" },
      { category: "Storage & Backup", label: "Customer Data Hosted", value: "Full mirror — all tiers" },
      { category: "Storage & Backup", label: "Backup", value: "Daily sync from all production nodes" },
      { category: "Operations", label: "Uptime (90d)", value: "99.80%" },
    ],
    revisions: [
      { revision: 1, ago: "1 year ago", author: "barry", summary: "Initial page created.", changes: [] },
      {
        revision: 2,
        ago: "10 months ago",
        author: "barry",
        summary: "Expanded the RAID array ahead of the Azure Thornwake onboarding.",
        changes: [{ field: "Storage", from: "20TB RAID 6", to: "40TB RAID 6" }],
      },
      {
        revision: 3,
        ago: "7 months ago",
        author: "priya",
        summary: "Upgraded chassis to the R760 refresh.",
        changes: [{ field: "Instance Size", from: "Dell PowerEdge R740", to: "Dell PowerEdge R760" }],
      },
      {
        revision: 4,
        ago: "5 months ago",
        author: "priya",
        summary: "Added memory to speed up mirror rebuild times.",
        changes: [{ field: "RAM", from: "128GB", to: "256GB" }],
      },
      {
        revision: 5,
        ago: "2 months ago",
        author: "priya",
        summary: "Added a second CPU socket for parallel replication streams.",
        changes: [{ field: "CPU", from: "16vcpu", to: "32vcpu" }],
      },
      {
        revision: 6,
        ago: "3 weeks ago",
        author: "priya",
        summary: "Tightened DR sync cadence from twice-daily to a continuous daily sync.",
        changes: [{ field: "Backup", from: "Twice-daily sync", to: "Daily sync from all production nodes" }],
      },
    ],
  },
  {
    slug: "prod-oracle-mistvane",
    title: "prod-oracle-mistvane",
    type: "server",
    region: "Oracle Cloud us-phoenix-1",
    image: img("mistvane-datacenter"),
    inSection: true,
    warning:
      "Newest node in the fleet — still burning in. Do not onboard additional customer shards here until the Q3 capacity review signs off.",
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Oracle Cloud Infrastructure" },
      { category: "Compute", label: "Region", value: "us-phoenix-1 (Phoenix, AZ)" },
      { category: "Compute", label: "IP", value: "10.77.3.19" },
      { category: "Compute", label: "Instance Size", value: "VM.Standard3.Flex (4 OCPU)" },
      { category: "Compute", label: "RAM", value: "32GB" },
      { category: "Compute", label: "CPU", value: "4vcpu" },
      { category: "Compute", label: "Operating System", value: "Oracle Linux 9" },
      { category: "Compute", label: "Traffic", value: "Pay-per-GB (OCI egress pricing)" },
      { category: "Storage & Backup", label: "Storage", value: "4TB Block Volume" },
      { category: "Storage & Backup", label: "Storage Role", value: "Customer object storage — newest hot tier (Phoenix expansion)" },
      { category: "Storage & Backup", label: "Customer Data Hosted", value: "~3.1TB (encrypted at rest)" },
      { category: "Storage & Backup", label: "Backup", value: "Every 6 hours, 30-day retention" },
      { category: "Operations", label: "Uptime (90d)", value: "99.90%" },
    ],
    revisions: [
      {
        revision: 1,
        ago: "2 months ago",
        author: "marcus",
        summary: "Initial page created — new Oracle Cloud region onboarded for Phoenix expansion.",
        changes: [],
      },
      {
        revision: 2,
        ago: "3 weeks ago",
        author: "marcus",
        summary: "Bumped instance size after initial load testing showed headroom needed.",
        changes: [
          { field: "Instance Size", from: "VM.Standard3.Flex (4 OCPU)", to: "VM.Standard3.Flex (8 OCPU)" },
          { field: "RAM", from: "32GB", to: "64GB" },
        ],
      },
      {
        revision: 3,
        ago: "4 days ago",
        author: "priya",
        summary: "Documented admin console access and on-call escalation path.",
        changes: [
          {
            field: "Admin Console",
            from: "(not documented)",
            to: "https://console.oraclecloud.com/nimbusvault-prod (SSO via Okta)",
            category: "Operations",
          },
          {
            field: "On-call Contact",
            from: "(not documented)",
            to: "#infra-oncall Slack, PagerDuty \"Storage-Prod\" schedule",
            category: "Operations",
          },
        ],
      },
    ],
  },
];

const contentItems: ItemSpec[] = [
  {
    slug: "member-onboarding-guide",
    title: "Member Onboarding Guide",
    type: "document",
    region: null,
    image: null,
    inSection: false,
    baseDetails: [
      { category: "Onboarding", label: "Provision laptop, VPN, and SSO credentials", value: "IT Helpdesk — Day 1" },
      { category: "Onboarding", label: "Grant read access to Storage Architecture book", value: "Team Lead — Day 1" },
      { category: "Onboarding", label: "Shadow an on-call rotation walkthrough", value: "Barry Jenkins — Day 2" },
      { category: "Onboarding", label: "Get added to the #infra-oncall Slack channel", value: "Team Lead — Day 3" },
    ],
    revisions: [
      { revision: 1, ago: "3 years ago", author: "barry", summary: "Initial page created.", changes: [] },
      {
        revision: 2,
        ago: "2 months ago",
        author: "priya",
        summary: "Added an encryption-at-rest training step and a DR-drill shadowing task to the checklist.",
        changes: [
          {
            field: "Complete data handling & encryption-at-rest training",
            from: "(not on checklist)",
            to: "Security & Compliance — Day 3",
            category: "Onboarding",
          },
          {
            field: "Pair on a real DR drill (read-only observer)",
            from: "(not on checklist)",
            to: "Priya Anand — Week 2",
            category: "Onboarding",
          },
        ],
      },
    ],
  },
  {
    slug: "it-holiday-party-event",
    title: "IT Holiday Party Event",
    type: "document",
    region: null,
    image: null,
    inSection: false,
    baseDetails: [
      { category: "Event", label: "Date", value: "Friday, December 12" },
      { category: "Event", label: "Location", value: "NimbusVault HQ Cafeteria" },
      { category: "Event", label: "Dress Code", value: "Festive casual" },
      { category: "Event", label: "RSVP Deadline", value: "November 24 via the #it-department Slack channel" },
    ],
    revisions: [
      { revision: 1, ago: "1 year ago", author: "marcus", summary: "Initial page created.", changes: [] },
      {
        revision: 2,
        ago: "7 months ago",
        author: "marcus",
        summary: "Moved venue after last year's space got too small.",
        changes: [{ field: "Location", from: "NimbusVault HQ Cafeteria", to: "The Foundry Hall, Austin, TX" }],
      },
      {
        revision: 3,
        ago: "2 months ago",
        author: "marcus",
        summary: "Added a server-rack-themed trivia block to the schedule.",
        changes: [],
      },
      {
        revision: 4,
        ago: "3 weeks ago",
        author: "marcus",
        summary: "Pushed the RSVP deadline back a week after requests from the on-call team.",
        changes: [{ field: "RSVP Deadline", from: "November 24 via the #it-department Slack channel", to: "December 1 via the #it-department Slack channel" }],
      },
    ],
  },
  {
    slug: "server-outage-plan",
    title: "Server Outage Plan",
    type: "document",
    region: null,
    image: null,
    inSection: false,
    baseDetails: [
      { category: "Severity", label: "SEV-1", value: "Customer data unavailable or at risk of loss — < 10 min response" },
      { category: "Severity", label: "SEV-2", value: "Single node or region degraded, redundancy intact — < 15 min response" },
      { category: "Severity", label: "SEV-3", value: "Non-customer-facing service degraded — < 1 hour response" },
      { category: "Severity", label: "SEV-4", value: "Cosmetic or monitoring-only issue — next business day" },
    ],
    revisions: [
      { revision: 1, ago: "4 years ago", author: "barry", summary: "Initial page created.", changes: [] },
      {
        revision: 2,
        ago: "2 years ago",
        author: "barry",
        summary: "Introduced the four-tier severity model to replace the old binary up/down classification.",
        changes: [],
      },
      {
        revision: 3,
        ago: "9 months ago",
        author: "priya",
        summary: "Tightened the SEV-1 response target after the Q1 incident review.",
        changes: [
          {
            field: "SEV-1",
            from: "Customer data unavailable or at risk of loss — < 10 min response",
            to: "Customer data unavailable or at risk of loss — Immediate response",
          },
        ],
      },
      {
        revision: 4,
        ago: "1 week ago",
        author: "priya",
        summary: "Added the mandatory postmortem step for SEV-1/SEV-2 incidents.",
        changes: [],
      },
    ],
  },
];

// Illustrative client case: Oberlinhaus (Potsdam/Berlin) is a real diaconal provider of
// disability care, health, education, and vocational services (oberlinhaus.de). This is a
// fictional sample of what an MSP like michi.ws might document for a client like them when
// hosting on unit.cloud's private cloud — not a representation of Oberlinhaus's actual systems.
const oberlinhausServers: ItemSpec[] = [
  {
    slug: "pve-unitcloud-potsdam-01",
    title: "pve-unitcloud-potsdam-01",
    type: "server",
    region: "unit.cloud Private Cloud — Rechenzentrum Frankfurt/Main",
    image: img("oberlinhaus-pve-cluster"),
    inSection: true,
    warning:
      "Wartungsfenster ausschließlich Di/Do 22:00–24:00 Uhr — Schichtübergabe in den Wohnstätten darf nicht gestört werden. Vorher Rücksprache mit dem michi.ws NOC.",
    baseDetails: [
      { category: "Compute", label: "Environment", value: "unit.cloud Private Cloud (Proxmox VE 8, dediziertes Cluster)" },
      { category: "Compute", label: "IP", value: "10.20.0.1" },
      { category: "Compute", label: "Instance Size", value: "2x AMD EPYC 7443P, 512GB RAM" },
      { category: "Compute", label: "CPU", value: "48 vCPU (Cluster-Kapazität)" },
      { category: "Compute", label: "RAM", value: "512GB" },
      { category: "Compute", label: "Operating System", value: "Proxmox VE 8 (Debian-based)" },
      { category: "Compute", label: "Traffic", value: "Unmetered (unit.cloud private backbone)" },
      { category: "Storage & Backup", label: "Storage", value: "8TB NVMe RAID10" },
      { category: "Storage & Backup", label: "Storage Role", value: "Hypervisor-Host für alle produktiven Oberlinhaus-VMs" },
      { category: "Storage & Backup", label: "Backup", value: "Nightly Snapshot + Replikation zu unit.cloud RZ Nürnberg" },
      { category: "Operations", label: "Uptime (90d)", value: "99.96%" },
      { category: "Operations", label: "Betreut durch", value: "unit.cloud (Infrastruktur) / michi.ws (Konfiguration & Monitoring)" },
      { category: "Zugang", label: "Admin-Login", value: "obh-cluster-admin" },
    ],
    revisions: [
      { revision: 1, ago: "2 years ago", author: "michael", summary: "Cluster initial für Oberlinhaus provisioniert.", changes: [] },
      {
        revision: 2,
        ago: "6 months ago",
        author: "michael",
        summary: "RAM-Aufrüstung nach Einführung der neuen Bewohnerverwaltung.",
        changes: [{ field: "Instance Size", from: "2x AMD EPYC 7443P, 256GB RAM", to: "2x AMD EPYC 7443P, 512GB RAM" }],
      },
      {
        revision: 3,
        ago: "3 weeks ago",
        author: "michael",
        summary: "Backup-Replikation von wöchentlich auf nightly umgestellt.",
        changes: [{ field: "Backup", from: "Weekly Snapshot + Replikation zu unit.cloud RZ Nürnberg", to: "Nightly Snapshot + Replikation zu unit.cloud RZ Nürnberg" }],
      },
    ],
  },
  {
    slug: "vm-bewohnerverwaltung",
    title: "vm-bewohnerverwaltung",
    type: "server",
    region: "unit.cloud Private Cloud — VM (Windows Server 2022)",
    image: img("oberlinhaus-bewohnerverwaltung"),
    inSection: true,
    warning:
      "Enthält besondere Kategorien personenbezogener Daten (Gesundheitsdaten) gem. Art. 9 DSGVO. Zugriff ausschließlich für autorisiertes Pflege- und Verwaltungspersonal — Zugriffsprotokoll wird von michi.ws quartalsweise geprüft.",
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Windows Server 2022 (VM auf pve-unitcloud-potsdam-01)" },
      { category: "Compute", label: "IP", value: "10.20.1.11" },
      { category: "Compute", label: "Instance Size", value: "8 vCPU / 32GB RAM" },
      { category: "Compute", label: "CPU", value: "8 vCPU" },
      { category: "Compute", label: "RAM", value: "32GB" },
      { category: "Compute", label: "Operating System", value: "Windows Server 2022" },
      { category: "Compute", label: "Traffic", value: "Unmetered (unit.cloud private backbone)" },
      { category: "Storage & Backup", label: "Storage", value: "1TB" },
      { category: "Storage & Backup", label: "Storage Role", value: "Bewohner- und Fallverwaltung für die Wohnstätten Potsdam, Kleinmachnow und Werder (Havel)" },
      { category: "Storage & Backup", label: "Backup", value: "Nightly, 90 Tage Aufbewahrung (Offsite-Replikation)" },
      { category: "Compliance", label: "Datenkategorie", value: "Besondere Kategorien personenbezogener Daten (Gesundheitsdaten), Art. 9 DSGVO" },
      { category: "Operations", label: "Uptime (90d)", value: "99.90%" },
      { category: "Zugang", label: "Service-Account", value: "svc-bewohnerverwaltung" },
    ],
    revisions: [
      { revision: 1, ago: "2 years ago", author: "michael", summary: "System für die Wohnstätten Potsdam/Kleinmachnow in Betrieb genommen.", changes: [] },
      {
        revision: 2,
        ago: "9 months ago",
        author: "michael",
        summary: "Werder (Havel) an die zentrale Bewohnerverwaltung angebunden.",
        changes: [{ field: "Storage Role", from: "Bewohner- und Fallverwaltung für die Wohnstätten Potsdam und Kleinmachnow", to: "Bewohner- und Fallverwaltung für die Wohnstätten Potsdam, Kleinmachnow und Werder (Havel)" }],
      },
      {
        revision: 3,
        ago: "2 months ago",
        author: "michael",
        summary: "Aufbewahrungsfrist für Offsite-Backups auf Anfrage der Compliance-Beauftragten verlängert.",
        changes: [{ field: "Backup", from: "Nightly, 60 Tage Aufbewahrung (Offsite-Replikation)", to: "Nightly, 90 Tage Aufbewahrung (Offsite-Replikation)" }],
      },
    ],
  },
  {
    slug: "vm-schulverwaltung",
    title: "vm-schulverwaltung",
    type: "server",
    region: "unit.cloud Private Cloud — VM (Windows Server 2022)",
    image: img("oberlinhaus-schulverwaltung"),
    inSection: true,
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Windows Server 2022 (VM auf pve-unitcloud-potsdam-01)" },
      { category: "Compute", label: "IP", value: "10.20.1.12" },
      { category: "Compute", label: "Instance Size", value: "4 vCPU / 16GB RAM" },
      { category: "Compute", label: "CPU", value: "4 vCPU" },
      { category: "Compute", label: "RAM", value: "16GB" },
      { category: "Compute", label: "Operating System", value: "Windows Server 2022" },
      { category: "Compute", label: "Traffic", value: "Unmetered (unit.cloud private backbone)" },
      { category: "Storage & Backup", label: "Storage", value: "500GB" },
      { category: "Storage & Backup", label: "Storage Role", value: "Schulverwaltungssoftware für die Oberlin-Schulen und Kindertagesstätten (Potsdam, Michendorf)" },
      { category: "Storage & Backup", label: "Backup", value: "Nightly, 30 Tage Aufbewahrung" },
      { category: "Operations", label: "Uptime (90d)", value: "99.85%" },
      { category: "Zugang", label: "Service-Account", value: "svc-schulverwaltung" },
    ],
    revisions: [
      { revision: 1, ago: "18 months ago", author: "michael", summary: "Schulverwaltung von lokalem Server in die unit.cloud Private Cloud migriert.", changes: [] },
      {
        revision: 2,
        ago: "4 months ago",
        author: "michael",
        summary: "Kindertagesstätten Michendorf in die zentrale Verwaltung aufgenommen.",
        changes: [{ field: "Storage Role", from: "Schulverwaltungssoftware für die Oberlin-Schulen (Potsdam)", to: "Schulverwaltungssoftware für die Oberlin-Schulen und Kindertagesstätten (Potsdam, Michendorf)" }],
      },
    ],
  },
  {
    slug: "vm-fileserver-potsdam",
    title: "vm-fileserver-potsdam",
    type: "server",
    region: "unit.cloud Private Cloud — VM (Windows Server 2022)",
    image: img("oberlinhaus-fileserver"),
    inSection: true,
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Windows Server 2022 (VM auf pve-unitcloud-potsdam-01)" },
      { category: "Compute", label: "IP", value: "10.20.1.13" },
      { category: "Compute", label: "Instance Size", value: "4 vCPU / 16GB RAM" },
      { category: "Compute", label: "CPU", value: "4 vCPU" },
      { category: "Compute", label: "RAM", value: "16GB" },
      { category: "Compute", label: "Operating System", value: "Windows Server 2022" },
      { category: "Compute", label: "Traffic", value: "Unmetered (unit.cloud private backbone)" },
      { category: "Storage & Backup", label: "Storage", value: "4TB" },
      { category: "Storage & Backup", label: "Storage Role", value: "Datei- und Druckserver, Hauptstandort Potsdam-Babelsberg" },
      { category: "Storage & Backup", label: "Backup", value: "Nightly, 30 Tage Aufbewahrung" },
      { category: "Operations", label: "Uptime (90d)", value: "99.93%" },
      { category: "Zugang", label: "Service-Account", value: "svc-fileserver-potsdam" },
    ],
    revisions: [
      { revision: 1, ago: "2 years ago", author: "michael", summary: "Initial eingerichtet.", changes: [] },
      {
        revision: 2,
        ago: "5 months ago",
        author: "michael",
        summary: "Speicherplatz nach Umstellung auf digitale Aktenführung erweitert.",
        changes: [{ field: "Storage", from: "2TB", to: "4TB" }],
      },
    ],
  },
  {
    slug: "vm-personalverwaltung",
    title: "vm-personalverwaltung",
    type: "server",
    region: "unit.cloud Private Cloud — VM (Windows Server 2022)",
    image: img("oberlinhaus-personalverwaltung"),
    inSection: true,
    baseDetails: [
      { category: "Compute", label: "Environment", value: "Windows Server 2022 (VM auf pve-unitcloud-potsdam-01)" },
      { category: "Compute", label: "IP", value: "10.20.1.14" },
      { category: "Compute", label: "Instance Size", value: "6 vCPU / 24GB RAM" },
      { category: "Compute", label: "CPU", value: "6 vCPU" },
      { category: "Compute", label: "RAM", value: "24GB" },
      { category: "Compute", label: "Operating System", value: "Windows Server 2022" },
      { category: "Compute", label: "Traffic", value: "Unmetered (unit.cloud private backbone)" },
      { category: "Storage & Backup", label: "Storage", value: "750GB" },
      { category: "Storage & Backup", label: "Storage Role", value: "Personalverwaltung, Lohnbuchhaltung und Zeiterfassung für ca. 2.300 Mitarbeitende im Schichtbetrieb" },
      { category: "Storage & Backup", label: "Backup", value: "Nightly, 90 Tage Aufbewahrung" },
      { category: "Compliance", label: "Datenkategorie", value: "Personenbezogene Beschäftigtendaten gem. § 26 BDSG" },
      { category: "Operations", label: "Uptime (90d)", value: "99.91%" },
      { category: "Zugang", label: "Service-Account", value: "svc-personalverwaltung" },
    ],
    revisions: [
      { revision: 1, ago: "3 years ago", author: "michael", summary: "Initial eingerichtet.", changes: [] },
      {
        revision: 2,
        ago: "7 months ago",
        author: "michael",
        summary: "Zeiterfassung für Schichtbetrieb in den Wohnstätten ergänzt.",
        changes: [{ field: "Storage Role", from: "Personalverwaltung und Lohnbuchhaltung für ca. 2.300 Mitarbeitende", to: "Personalverwaltung, Lohnbuchhaltung und Zeiterfassung für ca. 2.300 Mitarbeitende im Schichtbetrieb" }],
      },
    ],
  },
  {
    slug: "pbx-3cx-oberlinhaus",
    title: "pbx-3cx-oberlinhaus",
    type: "service",
    region: "unit.cloud Cloud-PBX (3CX)",
    image: img("oberlinhaus-pbx"),
    inSection: true,
    baseDetails: [
      { category: "Compute", label: "Environment", value: "unit.cloud Cloud-PBX (3CX)" },
      { category: "Compute", label: "IP", value: "10.20.2.20" },
      { category: "Storage & Backup", label: "Storage Role", value: "Telefonanlage für alle Standorte: Potsdam, Berlin, Michendorf, Bad Belzig, Kleinmachnow, Werder (Havel), Wolfsburg" },
      { category: "Storage & Backup", label: "Backup", value: "Weekly Konfigurations-Backup" },
      { category: "Operations", label: "Uptime (90d)", value: "99.98%" },
      { category: "Operations", label: "Betreut durch", value: "unit.cloud (Cloud-PBX Betrieb)" },
      { category: "Zugang", label: "Admin-Login", value: "obh-pbx-admin" },
    ],
    revisions: [
      { revision: 1, ago: "1 year ago", author: "michael", summary: "3CX-Telefonanlage für alle Standorte eingeführt, abgelöst frühere lokale Anlagen.", changes: [] },
      {
        revision: 2,
        ago: "2 months ago",
        author: "michael",
        summary: "Wolfsburg als letzter Standort auf die zentrale Telefonanlage umgestellt.",
        changes: [{ field: "Storage Role", from: "Telefonanlage für Potsdam, Berlin, Michendorf, Bad Belzig, Kleinmachnow, Werder (Havel)", to: "Telefonanlage für alle Standorte: Potsdam, Berlin, Michendorf, Bad Belzig, Kleinmachnow, Werder (Havel), Wolfsburg" }],
      },
    ],
  },
  {
    slug: "vpn-gateway-oberlinhaus",
    title: "vpn-gateway-oberlinhaus",
    type: "network-device",
    region: "unit.cloud Private Cloud — Netzwerk",
    image: img("oberlinhaus-vpn-gateway"),
    inSection: true,
    baseDetails: [
      { category: "Compute", label: "Environment", value: "pfSense (VM auf pve-unitcloud-potsdam-01)" },
      { category: "Compute", label: "IP", value: "10.20.0.254" },
      { category: "Storage & Backup", label: "Storage Role", value: "Site-to-Site VPN — verbindet alle 7 Standorte mit dem unit.cloud Private Cloud Cluster" },
      { category: "Operations", label: "Uptime (90d)", value: "99.95%" },
      { category: "Operations", label: "Betreut durch", value: "michi.ws (Netzwerk & Security)" },
      { category: "Zugang", label: "Admin-Login", value: "obh-vpn-admin" },
    ],
    revisions: [
      { revision: 1, ago: "2 years ago", author: "michael", summary: "VPN-Gateway für die ersten 5 Standorte eingerichtet.", changes: [] },
      {
        revision: 2,
        ago: "10 months ago",
        author: "michael",
        summary: "Bad Belzig und Wolfsburg per Site-to-Site-Tunnel angebunden.",
        changes: [{ field: "Storage Role", from: "Site-to-Site VPN — verbindet 5 Standorte mit dem unit.cloud Private Cloud Cluster", to: "Site-to-Site VPN — verbindet alle 7 Standorte mit dem unit.cloud Private Cloud Cluster" }],
      },
    ],
  },
  {
    slug: "backup-dr-node-nuernberg",
    title: "backup-dr-node-nuernberg",
    type: "server",
    region: "unit.cloud Private Cloud — Rechenzentrum Nürnberg (DR)",
    image: img("oberlinhaus-dr-nuernberg"),
    inSection: true,
    warning:
      "Failover-Ziel bei einem Ausfall des Rechenzentrums Frankfurt/Main. DR-Drills nur nach vorheriger Abstimmung mit michi.ws und dem unit.cloud NOC.",
    baseDetails: [
      { category: "Compute", label: "Environment", value: "unit.cloud Private Cloud (Proxmox VE 8, DR-Standort)" },
      { category: "Compute", label: "IP", value: "10.30.0.1" },
      { category: "Compute", label: "Instance Size", value: "1x AMD EPYC 7443P, 256GB RAM" },
      { category: "Compute", label: "CPU", value: "1x AMD EPYC 7443P" },
      { category: "Compute", label: "RAM", value: "256GB" },
      { category: "Compute", label: "Operating System", value: "Proxmox VE 8 (Debian-based)" },
      { category: "Compute", label: "Traffic", value: "Unmetered (unit.cloud private backbone)" },
      { category: "Storage & Backup", label: "Storage", value: "8TB NVMe RAID10" },
      { category: "Storage & Backup", label: "Storage Role", value: "Offsite-Backup- und Failover-Replik für alle produktiven Oberlinhaus-Systeme" },
      { category: "Storage & Backup", label: "Backup", value: "Kontinuierliche Replikation von pve-unitcloud-potsdam-01" },
      { category: "Operations", label: "Uptime (90d)", value: "99.99%" },
      { category: "Zugang", label: "Admin-Login", value: "obh-dr-admin" },
    ],
    revisions: [
      { revision: 1, ago: "1 year ago", author: "michael", summary: "DR-Standort Nürnberg in Betrieb genommen.", changes: [] },
      {
        revision: 2,
        ago: "1 month ago",
        author: "michael",
        summary: "Von nächtlicher Replikation auf kontinuierliche Replikation umgestellt.",
        changes: [{ field: "Backup", from: "Nightly Replikation von pve-unitcloud-potsdam-01", to: "Kontinuierliche Replikation von pve-unitcloud-potsdam-01" }],
      },
    ],
  },
];

async function main() {
  console.log("Seeding NimbusVault...");

  const userSpecs = [
    { key: "barry", email: "barry@nimbusvault.io", displayName: "Barry Jenkins" },
    { key: "priya", email: "priya@nimbusvault.io", displayName: "Priya Anand" },
    { key: "marcus", email: "marcus@nimbusvault.io", displayName: "Marcus Lee" },
    { key: "michael", email: "michael@michi.ws", displayName: "Michael Weber (michi.ws)" },
    { key: "demo", email: "demo@nimbusvault.io", displayName: "Demo Account" },
  ] as const;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds: Record<string, string> = {};
  for (const u of userSpecs) {
    const [row] = await db
      .insert(users)
      .values({ email: u.email, displayName: u.displayName, passwordHash })
      .returning({ id: users.id });
    userIds[u.key] = row.id;
  }
  console.log(`Inserted ${userSpecs.length} users (demo password: ${DEMO_PASSWORD})`);

  const [itDepartment] = await db
    .insert(collections)
    .values({
      slug: "it-department",
      title: "IT Department",
      description:
        "Server inventory, storage cluster topology, and infrastructure runbooks for the platform that keeps customer data safe.",
      imageUrl: serverImage("nimbusvault-it-book", 600, 360),
      category: "Internal",
    })
    .returning();

  const [oberlinhausCollection] = await db
    .insert(collections)
    .values({
      slug: "oberlinhaus",
      title: "Oberlinhaus (Potsdam / Berlin)",
      description:
        "Server and system landscape for Oberlinhaus, a diaconal provider of disability care, health, education, and vocational services across Potsdam, Berlin, and Brandenburg. Hosted on unit.cloud's private cloud, managed by michi.ws.",
      imageUrl: serverImage("oberlinhaus-book", 600, 360),
      category: "Clients",
    })
    .returning();

  async function insertItems(collectionId: string, sectionName: string, specs: ItemSpec[]) {
    const inserted: Record<string, string> = {};
    for (const spec of specs) {
      let cumulativeFields = spec.baseDetails;
      const firstRevision = spec.revisions[0];
      const lastRevision = spec.revisions[spec.revisions.length - 1];

      const [itemRow] = await db
        .insert(items)
        .values({
          collectionId,
          type: spec.type,
          section: spec.inSection ? sectionName : null,
          slug: spec.slug,
          name: spec.title,
          region: spec.region,
          imageUrl: spec.image,
          warning: spec.warning ?? null,
          fields: spec.baseDetails,
          createdBy: userIds[firstRevision.author],
          updatedBy: userIds[lastRevision.author],
          currentRevision: lastRevision.revision,
          createdAt: agoDate(firstRevision.ago),
          updatedAt: agoDate(lastRevision.ago),
        })
        .returning();

      inserted[spec.slug] = itemRow.id;

      for (const rev of spec.revisions) {
        cumulativeFields = applyChanges(cumulativeFields, rev.changes);
        await db.insert(itemRevisions).values({
          itemId: itemRow.id,
          revisionNo: rev.revision,
          authorId: userIds[rev.author],
          summary: rev.summary,
          fieldsSnapshot: cumulativeFields,
          changes: rev.changes.map(({ field, from, to }) => ({ field, from, to })),
          createdAt: agoDate(rev.ago),
        });
      }

      await db.update(items).set({ fields: cumulativeFields }).where(eq(items.id, itemRow.id));
    }
    return inserted;
  }

  const allItDeptSpecs = [...servers, ...contentItems];
  await insertItems(itDepartment.id, "Server Systems", allItDeptSpecs);

  const oberlinhausItemIds = await insertItems(oberlinhausCollection.id, "Server & Systeme", oberlinhausServers);

  // Demo-only login secrets for the Oberlinhaus case, stored encrypted in the real
  // `credentials` table (masked-by-default, reveal-on-demand) instead of as plain hashed
  // text in `fields` — see CLAUDE.md's confirmed credentials-storage rule. Clearly fictional,
  // never used by any actual system.
  const ADMIN_DEMO_SECRET = "Obh-Admin-Demo-Only-2026!";
  const SERVICE_DEMO_SECRET = "Obh-Service-Demo-Only-2026!";
  const oberlinhausCredentials = [
    { slug: "pve-unitcloud-potsdam-01", label: "Admin-Login", username: "obh-cluster-admin", secret: ADMIN_DEMO_SECRET },
    { slug: "vm-bewohnerverwaltung", label: "Service-Account", username: "svc-bewohnerverwaltung", secret: SERVICE_DEMO_SECRET },
    { slug: "vm-schulverwaltung", label: "Service-Account", username: "svc-schulverwaltung", secret: SERVICE_DEMO_SECRET },
    { slug: "vm-fileserver-potsdam", label: "Service-Account", username: "svc-fileserver-potsdam", secret: SERVICE_DEMO_SECRET },
    { slug: "vm-personalverwaltung", label: "Service-Account", username: "svc-personalverwaltung", secret: SERVICE_DEMO_SECRET },
    { slug: "pbx-3cx-oberlinhaus", label: "Admin-Login", username: "obh-pbx-admin", secret: ADMIN_DEMO_SECRET },
    { slug: "vpn-gateway-oberlinhaus", label: "Admin-Login", username: "obh-vpn-admin", secret: ADMIN_DEMO_SECRET },
    { slug: "backup-dr-node-nuernberg", label: "Admin-Login", username: "obh-dr-admin", secret: ADMIN_DEMO_SECRET },
  ];

  for (const cred of oberlinhausCredentials) {
    const encrypted = encryptSecret(cred.secret);
    await db.insert(credentials).values({
      itemId: oberlinhausItemIds[cred.slug],
      label: cred.label,
      username: cred.username,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      createdBy: userIds.michael,
    });
  }

  console.log(`Inserted ${allItDeptSpecs.length + oberlinhausServers.length} items across 2 collections, with full revision history.`);
  console.log(`Inserted ${oberlinhausCredentials.length} encrypted demo credentials.`);
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
