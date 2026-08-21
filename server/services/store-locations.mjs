/** 门店地理坐标（用于多店对比地图看板） */
const LOCATIONS = {
  "dadao-yintan": { lat: 28.2984, lng: 112.9356, district: "长沙市望城区", address: "银杉路与金潇路交汇处" },
  "mock-xiangjiang": { lat: 28.195, lng: 112.969, district: "长沙市天心区", address: "湘江中路沿线" },
  "mock-meixi": { lat: 28.118, lng: 112.886, district: "长沙市岳麓区", address: "梅溪湖片区" },
};

const CITY_CENTERS = [
  { key: "长沙", lat: 28.228, lng: 112.938, district: "长沙市" },
  { key: "北京", lat: 39.904, lng: 116.407, district: "北京市" },
  { key: "上海", lat: 31.23, lng: 121.474, district: "上海市" },
  { key: "广州", lat: 23.129, lng: 113.264, district: "广州市" },
  { key: "深圳", lat: 22.543, lng: 114.058, district: "深圳市" },
  { key: "成都", lat: 30.572, lng: 104.066, district: "成都市" },
  { key: "重庆", lat: 29.563, lng: 106.551, district: "重庆市" },
];

function detectCityCenter(fallbackLocation, storeId) {
  const text = `${fallbackLocation || ""}${storeId || ""}`;
  for (const city of CITY_CENTERS) {
    if (text.includes(city.key)) return city;
  }
  return CITY_CENTERS.find((c) => c.key === "长沙");
}

export function getStoreLocation(storeId, fallbackLocation) {
  const loc = LOCATIONS[storeId];
  if (loc) return { ...loc };
  const center = detectCityCenter(fallbackLocation, storeId);
  const seed = [...String(storeId)].reduce((s, c) => s + c.charCodeAt(0), 0);
  return {
    lat: center.lat + ((seed % 17) - 8) * 0.008,
    lng: center.lng + ((seed % 23) - 11) * 0.008,
    district: center.district,
    address: fallbackLocation || "",
  };
}
