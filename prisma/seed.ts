import { PrismaClient, Role, ShiftStatus, BidStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, addHours, setHours, setMinutes } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  await prisma.notification.deleteMany();
  await prisma.outreachAttempt.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.shiftActivity.deleteMany();
  await prisma.shiftBid.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.departmentMembership.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  // Single default hospital that all existing tenants belong to.
  const hospital = await prisma.hospital.upsert({
    where: { id: "clHospital_default" },
    update: { name: "St. Michael's Hospital" },
    create: { id: "clHospital_default", name: "St. Michael's Hospital" },
  });

  const deptER = await prisma.department.findUniqueOrThrow({ where: { code: "ER" } });
  const deptICU = await prisma.department.findUniqueOrThrow({ where: { code: "ICU" } });
  const deptMED = await prisma.department.findUniqueOrThrow({ where: { code: "MED" } });

  // Backfill the default hospital onto every existing department.
  await prisma.department.updateMany({
    where: { hospitalId: null },
    data: { hospitalId: hospital.id },
  });

  const adminPassword = await bcrypt.hash("admin123", 12);
  const workerPassword = await bcrypt.hash("worker123", 12);

  const admin = await prisma.user.create({
    data: {
      name: "Sarah Chen",
      email: "admin@staffly.com",
      password: adminPassword,
      role: Role.ADMIN,
      department: "Staffing Office",
      position: "Staffing Coordinator",
      hospitalId: hospital.id,
      hireDate: new Date("2014-03-01"),
    },
  });

  const admin2 = await prisma.user.create({
    data: {
      name: "James Okafor",
      email: "admin2@staffly.com",
      password: adminPassword,
      role: Role.ADMIN,
      department: "Staffing Office",
      position: "Nurse Manager",
      hospitalId: hospital.id,
      hireDate: new Date("2012-09-15"),
    },
  });

  // Realistic hire-date spread; a couple of explicit seniorityRank overrides so
  // later phases can exercise both the rank-set and hireDate ordering paths.
  const workers = await Promise.all([
    prisma.user.create({
      data: {
        name: "Maria Santos",
        email: "worker1@staffly.com",
        password: workerPassword,
        role: Role.WORKER,
        department: "Emergency",
        position: "Registered Nurse",
        hospitalId: hospital.id,
        hireDate: new Date("2016-06-01"),
        seniorityRank: 1,
      },
    }),
    prisma.user.create({
      data: {
        name: "David Kim",
        email: "worker2@staffly.com",
        password: workerPassword,
        role: Role.WORKER,
        department: "ICU",
        position: "Registered Nurse",
        hospitalId: hospital.id,
        hireDate: new Date("2018-02-12"),
      },
    }),
    prisma.user.create({
      data: {
        name: "Aisha Patel",
        email: "worker3@staffly.com",
        password: workerPassword,
        role: Role.WORKER,
        department: "Medical/Surgical",
        position: "Registered Nurse",
        hospitalId: hospital.id,
        hireDate: new Date("2015-11-20"),
        seniorityRank: 2,
      },
    }),
    prisma.user.create({
      data: {
        name: "Thomas Nguyen",
        email: "worker4@staffly.com",
        password: workerPassword,
        role: Role.WORKER,
        department: "Emergency",
        position: "Personal Support Worker",
        hospitalId: hospital.id,
        hireDate: new Date("2021-08-05"),
      },
    }),
    prisma.user.create({
      data: {
        name: "Priya Sharma",
        email: "worker5@staffly.com",
        password: workerPassword,
        role: Role.WORKER,
        department: "ICU",
        position: "Registered Nurse",
        hospitalId: hospital.id,
        hireDate: new Date("2023-01-09"),
      },
    }),
  ]);

  await prisma.departmentMembership.createMany({
    data: [
      { departmentId: deptER.id, userId: workers[0].id, title: "Lead RN" },
      { departmentId: deptER.id, userId: workers[3].id, title: "ER Technician" },
      { departmentId: deptICU.id, userId: workers[1].id, title: "Lead RN" },
      { departmentId: deptICU.id, userId: workers[4].id, title: "RN" },
      { departmentId: deptMED.id, userId: workers[2].id, title: "RN" },
    ],
  });

  const today = new Date();

  const shift1Start = setMinutes(setHours(addDays(today, 1), 7), 0);
  const shift1 = await prisma.shift.create({
    data: {
      title: `${deptER.name} (${deptER.code}) – Registered Nurse`,
      unit: "4B",
      departmentId: deptER.id,
      roleNeeded: "Registered Nurse",
      location: "St. Michael's Hospital – 30 Bond St.",
      startsAt: shift1Start,
      endsAt: addHours(shift1Start, 8),
      bidDeadlineAt: addHours(today, 4),
      notes: "ACLS certification required. Familiar with triage protocols.",
      status: ShiftStatus.OPEN,
      createdById: admin.id,
      hospitalId: hospital.id,
    },
  });

  await prisma.shiftActivity.create({
    data: {
      shiftId: shift1.id,
      actorId: admin.id,
      action: "SHIFT_CREATED",
      details: "Shift posted for Emergency callout coverage.",
    },
  });

  await prisma.shiftBid.createMany({
    data: [
      {
        shiftId: shift1.id,
        workerId: workers[0].id,
        note: "Available and ACLS certified. Can be there by 6:45am.",
        status: BidStatus.PENDING,
        hourlyRate: new Prisma.Decimal("68.00"),
      },
      {
        shiftId: shift1.id,
        workerId: workers[2].id,
        note: "Happy to cover. I worked this unit last month.",
        status: BidStatus.PENDING,
        hourlyRate: new Prisma.Decimal("65.50"),
      },
    ],
  });

  const shift2Start = setMinutes(setHours(today, 15), 0);
  const shift2 = await prisma.shift.create({
    data: {
      title: `${deptICU.name} (${deptICU.code}) – Registered Nurse`,
      unit: "3A",
      departmentId: deptICU.id,
      roleNeeded: "Registered Nurse",
      location: "St. Michael's Hospital – 30 Bond St.",
      startsAt: shift2Start,
      endsAt: addHours(shift2Start, 8),
      bidDeadlineAt: setMinutes(setHours(today, 10), 0),
      notes: "Critical care experience required.",
      status: ShiftStatus.ASSIGNED,
      createdById: admin.id,
      assignedWorkerId: workers[1].id,
      hospitalId: hospital.id,
    },
  });

  await prisma.shiftActivity.createMany({
    data: [
      {
        shiftId: shift2.id,
        actorId: admin.id,
        action: "SHIFT_CREATED",
        details: "Shift posted for ICU callout coverage.",
      },
      {
        shiftId: shift2.id,
        actorId: admin.id,
        action: "WORKER_ASSIGNED",
        details: `Assigned to ${workers[1].name}.`,
      },
    ],
  });

  await prisma.shiftBid.createMany({
    data: [
      {
        shiftId: shift2.id,
        workerId: workers[1].id,
        status: BidStatus.SELECTED,
        hourlyRate: new Prisma.Decimal("72.00"),
      },
      {
        shiftId: shift2.id,
        workerId: workers[4].id,
        status: BidStatus.NOT_SELECTED,
        hourlyRate: new Prisma.Decimal("70.00"),
      },
    ],
  });

  const shift3Start = setMinutes(setHours(addDays(today, 2), 23), 0);
  const shift3 = await prisma.shift.create({
    data: {
      title: `${deptMED.name} (${deptMED.code}) – Registered Nurse`,
      unit: "5C",
      departmentId: deptMED.id,
      roleNeeded: "Registered Nurse",
      location: "St. Joseph's Health Centre – 30 The Queensway",
      startsAt: shift3Start,
      endsAt: addHours(shift3Start, 8),
      bidDeadlineAt: addHours(addDays(today, 2), 14),
      notes: "Overnight shift. Patient load approximately 6–8 patients.",
      status: ShiftStatus.OPEN,
      createdById: admin2.id,
      hospitalId: hospital.id,
    },
  });

  await prisma.shiftActivity.create({
    data: {
      shiftId: shift3.id,
      actorId: admin2.id,
      action: "SHIFT_CREATED",
      details: "Night shift coverage needed at St. Joseph's.",
    },
  });

  await prisma.notification.createMany({
    data: [
      ...workers.map((w) => ({
        userId: w.id,
        type: "NEW_SHIFT" as const,
        title: "New Shift Available",
        message: `A new Emergency RN callout shift is available on ${shift1Start.toLocaleDateString()}.`,
        shiftId: shift1.id,
      })),
      ...workers.map((w) => ({
        userId: w.id,
        type: "NEW_SHIFT" as const,
        title: "New Shift Available",
        message: `A Med/Surg night callout shift is available at St. Joseph's.`,
        shiftId: shift3.id,
      })),
      {
        userId: workers[1].id,
        type: "BID_SELECTED" as const,
        title: "You've Been Assigned!",
        message: "You were selected for the ICU RN – Evening Callout shift.",
        shiftId: shift2.id,
        read: true,
      },
      {
        userId: workers[4].id,
        type: "BID_NOT_SELECTED" as const,
        title: "Shift Filled",
        message: "Another worker was selected for the ICU RN – Evening Callout shift.",
        shiftId: shift2.id,
        read: false,
      },
      {
        userId: admin.id,
        type: "BID_SUBMITTED" as const,
        title: "New Bid Received",
        message: `${workers[0].name} bid on Emergency RN – Day Shift Callout.`,
        shiftId: shift1.id,
        read: false,
      },
      {
        userId: admin.id,
        type: "BID_SUBMITTED" as const,
        title: "New Bid Received",
        message: `${workers[2].name} bid on Emergency RN – Day Shift Callout.`,
        shiftId: shift1.id,
        read: false,
      },
    ],
  });

  // Sample availability windows for a few workers.
  await prisma.availability.createMany({
    data: [
      {
        userId: workers[0].id,
        departmentId: deptER.id,
        startsAt: setMinutes(setHours(addDays(today, 1), 6), 0),
        endsAt: setMinutes(setHours(addDays(today, 1), 18), 0),
        status: "AVAILABLE",
      },
      {
        userId: workers[1].id,
        departmentId: deptICU.id,
        startsAt: setMinutes(setHours(addDays(today, 2), 7), 0),
        endsAt: setMinutes(setHours(addDays(today, 2), 19), 0),
        status: "TENTATIVE",
      },
      {
        userId: workers[3].id,
        departmentId: deptER.id,
        startsAt: setMinutes(setHours(addDays(today, 3), 8), 0),
        endsAt: setMinutes(setHours(addDays(today, 3), 20), 0),
        status: "UNAVAILABLE",
      },
      {
        userId: workers[4].id,
        startsAt: setMinutes(setHours(addDays(today, 1), 12), 0),
        endsAt: setMinutes(setHours(addDays(today, 1), 23), 0),
        status: "AVAILABLE",
      },
    ],
  });

  console.log("✓ Seed complete");
  console.log("\nDemo accounts:");
  console.log("  Admin:  admin@staffly.com  / admin123");
  console.log("  Admin:  admin2@staffly.com / admin123");
  console.log("  Worker: worker1@staffly.com / worker123 (Maria Santos – Emergency RN)");
  console.log("  Worker: worker2@staffly.com / worker123 (David Kim – ICU RN)");
  console.log("  Worker: worker3@staffly.com / worker123 (Aisha Patel – Med/Surg RN)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
