"""The local cloud and the executor.

LOCAL CLOUD = a moto server (mock AWS APIs) on 127.0.0.1:5055 with
  - S3 bucket "billing-exports": billing exports are delivered here like a CUR/FOCUS export
  - EC2 instances tagged Environment / Application, one per compute line in the billing data

The executor uses plain boto3. Only `endpoint_url` points at the local cloud; set
SPENDSENTINEL_CLOUD=aws (and give the process a scoped IAM role) to run the same
code against real AWS. moto is a mock: real AWS can behave differently.
"""
from __future__ import annotations

import os
import threading
import time

import boto3
from botocore.config import Config

PORT = int(os.environ.get("SPENDSENTINEL_CLOUD_PORT", "5055"))
REAL = os.environ.get("SPENDSENTINEL_CLOUD") == "aws"
ENDPOINT = None if REAL else f"http://127.0.0.1:{PORT}"
REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
BUCKET = os.environ.get("SPENDSENTINEL_BUCKET", "billing-exports")
_server = None

if not REAL:
    # Fake credentials so boto3 never touches a real account by accident.
    os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")


def start() -> str:
    """Start the in-process moto server (no Docker needed)."""
    global _server
    if REAL or _server:
        return ENDPOINT or "aws"
    import logging
    from moto.server import ThreadedMotoServer
    logging.getLogger("werkzeug").setLevel(logging.ERROR)  # one log line per AWS call is noise
    _server = ThreadedMotoServer(ip_address="127.0.0.1", port=PORT, verbose=False)
    _server.start()
    return ENDPOINT


def client(service: str):
    return boto3.client(service, region_name=REGION, endpoint_url=ENDPOINT, config=Config(retries={"max_attempts": 2}, connect_timeout=3, read_timeout=10))


def status() -> dict:
    try:
        client("s3").list_buckets()
        return {"ok": True, "endpoint": ENDPOINT or "aws", "mode": "aws" if REAL else "local (moto)", "bucket": BUCKET}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "endpoint": ENDPOINT, "error": str(e)[:200]}


# ---------------------------------------------------------------- S3 delivery

def ensure_bucket() -> None:
    s3 = client("s3")
    names = {b["Name"] for b in s3.list_buckets().get("Buckets", [])}
    if BUCKET not in names:
        s3.create_bucket(Bucket=BUCKET)


def deliver(key: str, body: bytes) -> dict:
    ensure_bucket()
    client("s3").put_object(Bucket=BUCKET, Key=key, Body=body, ContentType="text/csv")
    return {"bucket": BUCKET, "key": key, "bytes": len(body)}


def exports() -> list[dict]:
    ensure_bucket()
    out = client("s3").list_objects_v2(Bucket=BUCKET).get("Contents", [])
    return sorted(({"key": o["Key"], "bytes": o["Size"], "modified": o["LastModified"].isoformat()} for o in out), key=lambda o: o["modified"], reverse=True)


def fetch(key: str) -> bytes:
    return client("s3").get_object(Bucket=BUCKET, Key=key)["Body"].read()


# ---------------------------------------------------------------- EC2 estate

COMPUTE = ("elastic compute", "ec2")


_seed_lock = threading.Lock()


def seed_instances(lines: list[dict]) -> int:
    """One instance per (environment, application) compute line, if not there yet."""
    if REAL:
        return 0
    with _seed_lock:  # two imports at once must not create duplicates
        return _seed(lines)


def _seed(lines: list[dict]) -> int:
    ec2 = client("ec2")
    have = {(t.get("Environment"), t.get("Application")) for t in (_tags(i) for i in _instances(ec2))}
    image = ec2.describe_images(Owners=["amazon"])["Images"][0]["ImageId"]
    n = 0
    for ln in lines:
        key = (ln["environment"], ln["application"])
        if key in have:
            continue
        ec2.run_instances(ImageId=image, MinCount=1, MaxCount=1, InstanceType="t3.medium",
                          TagSpecifications=[{"ResourceType": "instance", "Tags": [
                              {"Key": "Environment", "Value": ln["environment"]}, {"Key": "Application", "Value": ln["application"]},
                              {"Key": "Name", "Value": f"{ln['environment']}-{ln['application']}"}, {"Key": "Service", "Value": ln["service"]}]}])
        have.add(key)
        n += 1
    return n


def _instances(ec2, filters=None) -> list[dict]:
    res = ec2.describe_instances(Filters=filters or [])
    return [i for r in res["Reservations"] for i in r["Instances"] if i["State"]["Name"] != "terminated"]


def _tags(i: dict) -> dict:
    return {t["Key"]: t["Value"] for t in i.get("Tags", [])}


def instances() -> list[dict]:
    ec2 = client("ec2")
    return [{"id": i["InstanceId"], "state": i["State"]["Name"], "type": i["InstanceType"], **{k.lower(): v for k, v in _tags(i).items()}} for i in _instances(ec2)]


# ---------------------------------------------------------------- executor (saga)

STEPS = ["Pre-check (policy + stale approval)", "Snapshot volumes", "Backup image (make-before-break)", "Health check: backup available",
         "Stop original instances", "Verify instances stopped", "Done"]


class StepFailed(Exception):
    pass


def run_park(action_id: str, environment: str, application: str, fail_at: int | None, emit) -> dict:
    """Park the compute behind one cost line: snapshot → image → stop → verify.
    Any failure undoes completed steps in reverse. `emit(step, label, status, detail)`."""
    ec2 = client("ec2")
    done: list[tuple[int, dict]] = []
    targets: list[str] = []

    def step(n: int, fn):
        if fail_at and n + 1 == fail_at:
            emit(n, STEPS[n], "failed", {"reason": "Simulated failure (requested)"})
            raise StepFailed(STEPS[n])
        detail = fn() or {}
        done.append((n, detail))
        emit(n, STEPS[n], "ok", detail)
        time.sleep(0.35)

    try:
        def precheck():
            nonlocal targets
            found = _instances(ec2, [{"Name": "tag:Environment", "Values": [environment]}, {"Name": "tag:Application", "Values": [application]},
                                     {"Name": "instance-state-name", "Values": ["running"]}])
            targets = [i["InstanceId"] for i in found]
            if not targets:
                raise StepFailed(f"No running instance tagged {environment}/{application}")
            return {"instances": targets}
        step(0, precheck)

        def snapshot():
            vols = [m["Ebs"]["VolumeId"] for i in _instances(ec2, [{"Name": "instance-id", "Values": targets}]) for m in i.get("BlockDeviceMappings", []) if "Ebs" in m]
            snaps = [ec2.create_snapshot(VolumeId=v, Description=f"SpendSentinel {action_id}")["SnapshotId"] for v in vols]
            return {"volumes": vols, "snapshots": snaps}
        step(1, snapshot)

        def image():
            imgs = [ec2.create_image(InstanceId=t, Name=f"ss-{action_id}-{t}", NoReboot=True)["ImageId"] for t in targets]
            ec2.create_tags(Resources=targets, Tags=[{"Key": "spendsentinel:parked-by", "Value": action_id}])
            return {"images": imgs}
        step(2, image)

        def health():
            imgs = done[-1][1]["images"]
            states = {i["ImageId"]: i["State"] for i in ec2.describe_images(ImageIds=imgs)["Images"]}
            if any(s != "available" for s in states.values()):
                raise StepFailed("Backup image not available")
            return {"images": states}
        step(3, health)

        step(4, lambda: {"stopping": [x["InstanceId"] for x in ec2.stop_instances(InstanceIds=targets)["StoppingInstances"]]})

        def verify():
            states = {i["InstanceId"]: i["State"]["Name"] for i in _instances(ec2, [{"Name": "instance-id", "Values": targets}])}
            if any(s not in ("stopped", "stopping") for s in states.values()):
                raise StepFailed("Instances still running")
            return {"states": states}
        step(5, verify)
        step(6, lambda: {"parked": targets})
        return {"outcome": "done", "instances": targets, "steps": [d for _, d in done]}
    except Exception as e:  # noqa: BLE001  (StepFailed or AWS error)
        if not isinstance(e, StepFailed):
            n = len(done)
            emit(n, STEPS[min(n, 6)], "failed", {"reason": str(e)[:200]})
        for n, detail in reversed(done):
            try:
                if n == 4 and targets:
                    ec2.start_instances(InstanceIds=targets)
                elif n == 2:
                    for img in detail.get("images", []):
                        ec2.deregister_image(ImageId=img)
                    ec2.delete_tags(Resources=targets, Tags=[{"Key": "spendsentinel:parked-by"}])
                elif n == 1:
                    for s in detail.get("snapshots", []):
                        ec2.delete_snapshot(SnapshotId=s)
                emit(n, "Undo: " + STEPS[n], "rolled-back", {})
            except Exception as undo_err:  # noqa: BLE001
                emit(n, "Undo failed: " + STEPS[n], "failed", {"reason": str(undo_err)[:200]})
            time.sleep(0.25)
        return {"outcome": "rolled-back", "reason": str(e)[:200], "instances": targets}


def unpark(environment: str, application: str) -> list[str]:
    ec2 = client("ec2")
    ids = [i["InstanceId"] for i in _instances(ec2, [{"Name": "tag:Environment", "Values": [environment]}, {"Name": "tag:Application", "Values": [application]}])]
    if ids:
        ec2.start_instances(InstanceIds=ids)
    return ids
