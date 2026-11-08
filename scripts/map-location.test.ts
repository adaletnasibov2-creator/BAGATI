import assert from "node:assert/strict";
import test from "node:test";
import { isValidCoordinates } from "../lib/map-location";
import { getPublicStoreMapMarkers } from "../lib/public-store-map";
import { createOrderAddressSnapshot } from "../lib/order-address-snapshot";

test("accepts global latitude and longitude boundaries", () => {
  assert.equal(isValidCoordinates({ latitude: -90, longitude: -180 }), true);
  assert.equal(isValidCoordinates({ latitude: 90, longitude: 180 }), true);
});

test("rejects non-finite and out-of-range coordinates", () => {
  assert.equal(isValidCoordinates({ latitude: 90.01, longitude: 0 }), false);
  assert.equal(isValidCoordinates({ latitude: 0, longitude: -180.01 }), false);
  assert.equal(isValidCoordinates({ latitude: Number.NaN, longitude: 0 }), false);
  assert.equal(isValidCoordinates({ latitude: 0, longitude: Number.POSITIVE_INFINITY }), false);
});

test("public map query uses shared eligibility rules and only selects public store fields", async () => {
  let query: any;
  const eligible = {
    status:"ACTIVE", isActive:true, legalInfoApproved:true, adminManaged:false,
    vendor:{sellerType:"INDIVIDUAL_ENTREPRENEUR",legalName:"Seller",voen:"1234567890",legalAddress:null,user:{isActive:true}},
    subscription:{status:"ACTIVE",currentPeriodStart:null,currentPeriodEnd:null,plan:{isActive:true,slug:"basic"}},
  };
  const records = [
    { ...eligible, id:"store-1", name:"BAGATI mağazası", slug:"bagati", address:"Mərkəz", logoUrl:"https://example.test/logo.png", latitude:40.4, longitude:49.8, city:{name:"Bakı",isActive:true}, vendor:{...eligible.vendor,vendorId:"private-vendor"}, email:"private@example.test" },
    { ...eligible, id:"store-2", name:"No pin", slug:"no-pin", address:null, logoUrl:null, latitude:null, longitude:null, city:{name:"Bakı",isActive:true} },
    { ...eligible, id:"store-3", name:"Invalid pin", slug:"bad-pin", address:null, logoUrl:null, latitude:91, longitude:200, city:{name:"Bakı",isActive:true} },
    { ...eligible, id:"store-4", name:"Whitespace legal name", slug:"blank-legal", address:null, logoUrl:null, latitude:40.4, longitude:49.8, city:{name:"Bakı",isActive:true}, vendor:{...eligible.vendor,legalName:" \t\n"} },
  ];
  const items = await getPublicStoreMapMarkers(async args => { query=args; return records as any; });
  assert.equal(query.where.status, "ACTIVE");
  assert.equal(query.where.isActive, true);
  assert.deepEqual(query.where.city, {isActive:true});
  assert.deepEqual(query.where.vendor.user, {isActive:true});
  assert.equal(query.where.legalInfoApproved, true);
  assert.equal(query.where.OR[0].adminManaged, true);
  const subscription = query.where.OR[1].subscription.is;
  assert.equal(subscription.status, "ACTIVE");
  assert.equal(subscription.plan.isActive, true);
  assert.deepEqual(subscription.plan.slug.in, ["basic", "pro", "professional"]);
  assert.ok(Array.isArray(subscription.AND));
  assert.deepEqual(query.where.latitude, {not:null});
  assert.deepEqual(query.where.longitude, {not:null});
  assert.deepEqual(Object.keys(query.select).sort(), ["address","adminManaged","city","id","isActive","latitude","legalInfoApproved","logoUrl","longitude","name","slug","status","subscription","vendor"].sort());
  assert.deepEqual(items, [{id:"store-1",name:"BAGATI mağazası",slug:"bagati",address:"Mərkəz",logoUrl:"https://example.test/logo.png",latitude:40.4,longitude:49.8,city:"Bakı"}]);
  assert.equal("vendorId" in items[0], false);
  assert.equal("email" in items[0], false);
});

test("order snapshots preserve selected coordinates and remain independent of later address edits", () => {
  const address = {recipientName:"Alıcı",phone:"+994000000",line1:"Ünvan 1",line2:null,postalCode:null,latitude:null,longitude:null,city:{name:"Bakı"}};
  const snapshot = createOrderAddressSnapshot(address, {latitude:40.4,longitude:49.8});
  address.line1 = "Sonradan dəyişdirildi";
  assert.equal(snapshot.line1, "Ünvan 1");
  assert.equal(snapshot.latitude, 40.4);
  assert.equal(snapshot.longitude, 49.8);
});

test("orders without a saved or selected pin stay compatible with address-only snapshots", () => {
  const address = {recipientName:"Alıcı",phone:"+994000000",line1:"Ünvan 1",line2:null,postalCode:null,latitude:null,longitude:null,city:{name:"Bakı"}};
  const snapshot = createOrderAddressSnapshot(address);
  assert.equal("latitude" in snapshot, false);
  assert.equal("longitude" in snapshot, false);
});
