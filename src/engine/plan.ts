// Turns a finding into a concrete, reviewable execution plan for the user's cloud.
// SpendSentinel never holds cloud credentials: the plan is run by the customer's
// engineer or pipeline, then verified from the next billing export.
import type { VerdictKind } from './types'

export type Cloud = 'aws' | 'azure' | 'gcp' | 'unknown'
export interface PlanStep { title: string; why: string; command?: string }
export interface ActionPlan {
  cloud: Cloud
  kind: 'park-compute' | 'park-database' | 'vpc-endpoint' | 'schedule' | 'review'
  target: { service: string; region: string; environment: string; application: string }
  discover: PlanStep
  backup: PlanStep
  change: PlanStep[]
  verify: PlanStep
  rollback: PlanStep
}

export function detectCloud(service: string, region: string): Cloud {
  const s = service.toLowerCase(), r = region.toLowerCase()
  // Service names are the strongest signal; region formats break ties.
  if (/^amazon|^aws|ec2|rds|s3\b|cloudwatch|lambda|nat gateway|elastic/.test(s)) return 'aws'
  if (/compute engine|cloud sql|cloud storage|bigquery|gcp|google/.test(s)) return 'gcp'
  if (/virtual machines|azure|storage accounts|sql database|bandwidth/.test(s)) return 'azure'
  if (/^(us|eu|ap|sa|ca|me|af|il)-[a-z]+-\d$/.test(r)) return 'aws'
  if (/^[a-z]+-[a-z]+\d$/.test(r)) return 'gcp'
  if (/^(east|west|central|north|south)[a-z]*\d?$|india|europe|asia/.test(r)) return 'azure'
  return 'unknown'
}

const isCompute = (s: string) => /ec2|elastic compute|compute engine|virtual machine|\bvm\b|instances?/i.test(s)
const isDatabase = (s: string) => /rds|relational database|cloud sql|sql database|aurora|cosmos/i.test(s)
const isNetwork = (s: string) => /nat|data transfer|datatransfer|bandwidth|egress|vpc/i.test(s)

/** Office hours (Mon–Fri, 08:00–20:00) cut the running time from 168 h to 60 h a week. */
export const SCHEDULE_SAVING = 1 - 60 / 168
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

export function buildSchedulePlan(t: ActionPlan['target']): ActionPlan {
  const cloud = detectCloud(t.service, t.region)
  const R = t.region === 'untagged' ? '<region>' : t.region
  const Z = tz()
  const name = `ss-${t.environment}-${t.application}`.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40)
  const base = { cloud, target: t, kind: 'schedule' as const }
  if (cloud === 'azure')
    return {
      ...base,
      discover: { title: `List VMs tagged ${t.environment}`, why: '', command: `az vm list -d --query "[?tags.Environment=='${t.environment}'].{name:name, rg:resourceGroup}" -o table` },
      backup: { title: 'No backup needed', why: 'Deallocating keeps disks and configuration.' },
      change: [{ title: 'Shut down every evening at 20:00', why: 'Azure auto-shutdown; start it in the morning with a runbook or Start/Stop VMs v2.', command: `az vm auto-shutdown -g <resource-group> -n <vm> --time 2000` }],
      verify: { title: 'Check the schedule', why: '', command: `az vm show -g <resource-group> -n <vm> --query "id"` },
      rollback: { title: 'Remove the auto-shutdown', why: '', command: `az vm auto-shutdown -g <resource-group> -n <vm> --off` },
    }
  if (cloud === 'gcp')
    return {
      ...base,
      discover: { title: `List instances labelled ${t.environment}`, why: '', command: `gcloud compute instances list --filter="labels.environment=${t.environment}"` },
      backup: { title: 'No backup needed', why: 'Stopped instances keep their disks.' },
      change: [
        { title: 'Create an office-hours schedule', why: `Runs Mon–Fri 08:00–20:00 (${Z}).`, command: `gcloud compute resource-policies create instance-schedule ${name} --region ${R} --vm-start-schedule="0 8 * * MON-FRI" --vm-stop-schedule="0 20 * * MON-FRI" --timezone=${Z}` },
        { title: 'Attach it to the instances', why: '', command: `gcloud compute instances add-resource-policies <instance> --zone <zone> --resource-policies ${name}` },
      ],
      verify: { title: 'Check the schedule', why: '', command: `gcloud compute resource-policies describe ${name} --region ${R}` },
      rollback: { title: 'Detach the schedule', why: '', command: `gcloud compute instances remove-resource-policies <instance> --zone <zone> --resource-policies ${name}` },
    }
  const f = tagFilter(t.environment, t.application)
  const target = (op: string) => `--target '{"Arn":"arn:aws:scheduler:::aws-sdk:ec2:${op}","RoleArn":"<scheduler-role-arn>","Input":"{\\"InstanceIds\\":[\\"<instance-id>\\"]}"}'`
  return {
    ...base,
    discover: { title: `List instances for ${t.environment} / ${t.application}`, why: 'Billing data is aggregated; this resolves the exact instance IDs.', command: `aws ec2 describe-instances --region ${R} ${f} --query "Reservations[].Instances[].[InstanceId,InstanceType,State.Name]" --output table` },
    backup: { title: 'Tag them for the schedule', why: 'Owners can see why the instances stop at night.', command: `aws ec2 create-tags --region ${R} --resources <instance-id> --tags Key=spendsentinel:schedule,Value=office-hours` },
    change: [
      { title: 'Stop every weekday at 20:00', why: `EventBridge Scheduler, ${Z}.`, command: `aws scheduler create-schedule --region ${R} --name ${name}-stop --schedule-expression "cron(0 20 ? * MON-FRI *)" --schedule-expression-timezone "${Z}" --flexible-time-window Mode=OFF ${target('stopInstances')}` },
      { title: 'Start every weekday at 08:00', why: 'Weekends stay off.', command: `aws scheduler create-schedule --region ${R} --name ${name}-start --schedule-expression "cron(0 8 ? * MON-FRI *)" --schedule-expression-timezone "${Z}" --flexible-time-window Mode=OFF ${target('startInstances')}` },
    ],
    verify: { title: 'Check both schedules exist', why: '', command: `aws scheduler list-schedules --region ${R} --name-prefix ${name}` },
    rollback: { title: 'Delete the schedules and start the instances', why: '', command: `aws scheduler delete-schedule --region ${R} --name ${name}-stop && aws scheduler delete-schedule --region ${R} --name ${name}-start && aws ec2 start-instances --region ${R} --instance-ids <instance-id>` },
  }
}

const tagFilter = (env: string, app: string) => {
  const f: string[] = []
  if (env !== 'untagged') f.push(`"Name=tag:Environment,Values=${env}"`)
  if (app !== 'untagged') f.push(`"Name=tag:Application,Values=${app}"`)
  return f.join(' ')
}

export function buildPlan(verdict: VerdictKind, t: ActionPlan['target']): ActionPlan | null {
  if (verdict === 'Growth') return null
  const cloud = detectCloud(t.service, t.region)
  const R = t.region === 'untagged' ? '<region>' : t.region
  const base = { cloud, target: t }

  if (verdict === 'Misconfig' || isNetwork(t.service)) {
    if (cloud === 'aws')
      return {
        ...base, kind: 'vpc-endpoint',
        discover: { title: 'Find the VPC and route tables sending S3/DynamoDB traffic through NAT', why: 'Gateway endpoints are attached per route table.', command: `aws ec2 describe-route-tables --region ${R} --query "RouteTables[?Routes[?NatGatewayId]].[VpcId,RouteTableId]" --output table` },
        backup: { title: 'Record the current routes', why: 'Lets you restore the exact routing if needed.', command: `aws ec2 describe-route-tables --region ${R} --route-table-ids <rtb-id> > routes-before.json` },
        change: [
          { title: 'Create an S3 gateway endpoint (no hourly or per-GB charge)', why: 'S3 traffic stops being billed as NAT data processing.', command: `aws ec2 create-vpc-endpoint --region ${R} --vpc-id <vpc-id> --vpc-endpoint-type Gateway --service-name com.amazonaws.${R}.s3 --route-table-ids <rtb-id>` },
          { title: 'Create a DynamoDB gateway endpoint if the service uses it', why: 'Same saving for DynamoDB traffic.', command: `aws ec2 create-vpc-endpoint --region ${R} --vpc-id <vpc-id> --vpc-endpoint-type Gateway --service-name com.amazonaws.${R}.dynamodb --route-table-ids <rtb-id>` },
        ],
        verify: { title: 'Confirm NAT bytes drop', why: 'Check before the next billing export arrives.', command: `aws cloudwatch get-metric-statistics --region ${R} --namespace AWS/NATGateway --metric-name BytesOutToDestination --dimensions Name=NatGatewayId,Value=<nat-id> --statistics Sum --period 86400 --start-time <yyyy-mm-dd> --end-time <yyyy-mm-dd>` },
        rollback: { title: 'Remove the endpoint', why: 'Traffic falls back to the NAT path automatically.', command: `aws ec2 delete-vpc-endpoints --region ${R} --vpc-endpoint-ids <vpce-id>` },
      }
    return reviewPlan(base, 'Route storage / database traffic through a private endpoint instead of the NAT or internet egress path.')
  }

  if (isDatabase(t.service)) {
    if (cloud === 'aws')
      return {
        ...base, kind: 'park-database',
        discover: { title: 'List database instances with these tags', why: 'Billing data is aggregated; this resolves the exact instances.', command: `aws rds describe-db-instances --region ${R} --query "DBInstances[].[DBInstanceIdentifier,DBInstanceClass,TagList]"` },
        backup: { title: 'Take a final snapshot', why: 'Restorable copy before stopping.', command: `aws rds create-db-snapshot --region ${R} --db-instance-identifier <db-id> --db-snapshot-identifier spendsentinel-<db-id>-<yyyymmdd>` },
        change: [{ title: 'Stop the instance', why: 'Compute charges stop; storage is still billed. AWS restarts stopped RDS after 7 days, so schedule or delete if unused.', command: `aws rds stop-db-instance --region ${R} --db-instance-identifier <db-id>` }],
        verify: { title: 'Confirm the status is stopped', why: '', command: `aws rds describe-db-instances --region ${R} --db-instance-identifier <db-id> --query "DBInstances[0].DBInstanceStatus"` },
        rollback: { title: 'Start it again', why: '', command: `aws rds start-db-instance --region ${R} --db-instance-identifier <db-id>` },
      }
    return reviewPlan(base, 'Snapshot, then stop or downsize the database serving this environment.')
  }

  if (isCompute(t.service) || verdict === 'Waste') {
    if (cloud === 'aws') {
      const f = tagFilter(t.environment, t.application)
      return {
        ...base, kind: 'park-compute',
        discover: { title: `List running instances for ${t.environment} / ${t.application}`, why: 'Billing data is aggregated; this resolves the exact instance IDs.', command: `aws ec2 describe-instances --region ${R} --filters "Name=instance-state-name,Values=running" ${f} --query "Reservations[].Instances[].[InstanceId,InstanceType,LaunchTime]" --output table` },
        backup: { title: 'Create a backup image (no reboot)', why: 'Restorable copy of disks and config.', command: `aws ec2 create-image --region ${R} --instance-id <instance-id> --name spendsentinel-<instance-id>-<yyyymmdd> --no-reboot` },
        change: [
          { title: 'Tag the instance as parked by SpendSentinel', why: 'Owners can see why it stopped.', command: `aws ec2 create-tags --region ${R} --resources <instance-id> --tags Key=spendsentinel:parked,Value=<yyyy-mm-dd>` },
          { title: 'Stop the instance', why: 'Compute charges stop; EBS storage and any Elastic IP are still billed.', command: `aws ec2 stop-instances --region ${R} --instance-ids <instance-id>` },
        ],
        verify: { title: 'Confirm it is stopped', why: '', command: `aws ec2 describe-instances --region ${R} --instance-ids <instance-id> --query "Reservations[0].Instances[0].State.Name"` },
        rollback: { title: 'Start it again', why: 'Same instance, same disks.', command: `aws ec2 start-instances --region ${R} --instance-ids <instance-id>` },
      }
    }
    if (cloud === 'azure')
      return {
        ...base, kind: 'park-compute',
        discover: { title: 'List VMs with these tags', why: '', command: `az vm list -d --query "[?tags.Environment=='${t.environment}'].{name:name, rg:resourceGroup, state:powerState}" -o table` },
        backup: { title: 'Snapshot the OS disk', why: '', command: `az snapshot create -g <resource-group> -n ss-<vm>-<yyyymmdd> --source <os-disk-id>` },
        change: [{ title: 'Deallocate the VM', why: 'Deallocated VMs stop compute billing; disks are still billed.', command: `az vm deallocate -g <resource-group> -n <vm>` }],
        verify: { title: 'Confirm power state', why: '', command: `az vm get-instance-view -g <resource-group> -n <vm> --query "instanceView.statuses[1].displayStatus"` },
        rollback: { title: 'Start it again', why: '', command: `az vm start -g <resource-group> -n <vm>` },
      }
    if (cloud === 'gcp')
      return {
        ...base, kind: 'park-compute',
        discover: { title: 'List instances with these labels', why: '', command: `gcloud compute instances list --filter="labels.environment=${t.environment} AND status=RUNNING"` },
        backup: { title: 'Snapshot the boot disk', why: '', command: `gcloud compute disks snapshot <disk> --zone <zone> --snapshot-names ss-<instance>-<yyyymmdd>` },
        change: [{ title: 'Stop the instance', why: 'Stopped instances stop vCPU/RAM billing; disks are still billed.', command: `gcloud compute instances stop <instance> --zone <zone>` }],
        verify: { title: 'Confirm status', why: '', command: `gcloud compute instances describe <instance> --zone <zone> --format="value(status)"` },
        rollback: { title: 'Start it again', why: '', command: `gcloud compute instances start <instance> --zone <zone>` },
      }
  }
  return reviewPlan(base, `Review ${t.service} usage in ${t.environment} and stop or resize what is not needed.`)
}

function reviewPlan(base: Pick<ActionPlan, 'cloud' | 'target'>, what: string): ActionPlan {
  return {
    ...base, kind: 'review',
    discover: { title: 'Identify the resources behind this cost line', why: `${base.target.service} · ${base.target.region} · env ${base.target.environment} · app ${base.target.application}` },
    backup: { title: 'Back up anything stateful first', why: 'Snapshot disks or databases before changing them.' },
    change: [{ title: what, why: 'SpendSentinel has no ready-made command for this service yet.' }],
    verify: { title: 'Check the next billing export', why: 'The ledger verifies the saving from your data.' },
    rollback: { title: 'Restore from the backup', why: '' },
  }
}

export function planAsText(p: ActionPlan): string {
  const steps = [p.discover, p.backup, ...p.change, p.verify]
  const lines = steps.map((s, i) => `# ${i + 1}. ${s.title}${s.why ? `\n#    ${s.why}` : ''}${s.command ? `\n${s.command}` : ''}`)
  lines.push(`# Rollback: ${p.rollback.title}${p.rollback.command ? `\n${p.rollback.command}` : ''}`)
  return `# SpendSentinel action plan · ${p.target.service} · ${p.target.region} · env=${p.target.environment} · app=${p.target.application}\n\n` + lines.join('\n\n')
}
