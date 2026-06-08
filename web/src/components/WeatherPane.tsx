import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import { CloudSun, MapPin, RefreshCw, Loader2, Search, Thermometer, Droplets, Wind } from "lucide-react";
import { cn } from "@/lib/cn";

const ReactECharts = lazy(() => import("echarts-for-react"));

const ChartFallback = () => (
  <div className="flex h-[240px] items-center justify-center text-neutral-300">
    <Loader2 className="h-4 w-4 animate-spin" />
  </div>
);

const CHINESE_CITIES = [
  { name: "北京", latitude: 39.9042, longitude: 116.4074 },
  { name: "上海", latitude: 31.2304, longitude: 121.4737 },
  { name: "广州", latitude: 23.1291, longitude: 113.2644 },
  { name: "深圳", latitude: 22.5431, longitude: 114.0579 },
  { name: "成都", latitude: 30.5728, longitude: 104.0668 },
  { name: "杭州", latitude: 30.2741, longitude: 120.1551 },
  { name: "武汉", latitude: 30.5928, longitude: 114.3055 },
  { name: "南京", latitude: 32.0603, longitude: 118.7969 },
  { name: "重庆", latitude: 29.563, longitude: 106.5516 },
  { name: "西安", latitude: 34.3416, longitude: 108.9398 },
  { name: "苏州", latitude: 31.299, longitude: 120.5853 },
  { name: "天津", latitude: 39.3434, longitude: 117.3616 },
  { name: "长沙", latitude: 28.2282, longitude: 112.9388 },
  { name: "郑州", latitude: 34.7466, longitude: 113.6253 },
  { name: "东莞", latitude: 23.0208, longitude: 113.7518 },
  { name: "青岛", latitude: 36.0671, longitude: 120.3826 },
  { name: "沈阳", latitude: 41.8057, longitude: 123.4315 },
  { name: "昆明", latitude: 25.0389, longitude: 102.7183 },
  { name: "宁波", latitude: 29.8679, longitude: 121.544 },
  { name: "大连", latitude: 38.914, longitude: 121.6147 },
  { name: "厦门", latitude: 24.4798, longitude: 118.0894 },
  { name: "福州", latitude: 26.0745, longitude: 119.2965 },
  { name: "合肥", latitude: 31.8206, longitude: 117.2272 },
  { name: "济南", latitude: 36.6512, longitude: 116.9972 },
  { name: "哈尔滨", latitude: 45.8038, longitude: 126.535 },
];

const WMO_EMOJI: Record<string, string> = {
  "0": "☀️", "1": "🌤️", "2": "⛅", "3": "☁️",
  "45": "🌫️", "48": "🌫️",
  "51": "🌦️", "53": "🌦️", "55": "🌦️",
  "61": "🌦️", "63": "🌧️", "65": "🌧️",
  "71": "🌨️", "73": "🌨️", "75": "❄️", "77": "❄️",
  "80": "🌦️", "81": "🌧️", "82": "🌧️",
  "85": "🌨️", "86": "❄️",
  "95": "⛈️", "96": "⛈️", "99": "⛈️",
};

const WMO_LABEL: Record<string, string> = {
  "0": "晴天", "1": "大部晴朗", "2": "局部多云", "3": "多云",
  "45": "雾", "48": "雾凇",
  "51": "小毛毛雨", "53": "中毛毛雨", "55": "大毛毛雨",
  "61": "小雨", "63": "中雨", "65": "大雨",
  "71": "小雪", "73": "中雪", "75": "大雪", "77": "雪粒",
  "80": "阵雨", "81": "中阵雨", "82": "大阵雨",
  "85": "小阵雪", "86": "大阵雪",
  "95": "雷暴", "96": "雷暴伴冰雹", "99": "雷暴伴大冰雹",
};

interface City {
  name: string;
  latitude: number;
  longitude: number;
}

interface DailyData {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  weather_code: number[];
  wind_speed_10m_max: number[];
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0] ?? "";
}

function todayString(): string {
  return formatDate(new Date());
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

export function WeatherPane() {
  const [selectedCity, setSelectedCity] = useState<City>(CHINESE_CITIES[0]!);
  const [startDate, setStartDate] = useState(() => daysAgo(30));
  const [endDate, setEndDate] = useState(() => todayString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DailyData | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<City[]>([]);

  const fetchWeather = useCallback(async () => {
    if (!selectedCity) return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const params = new URLSearchParams({
        latitude: String(selectedCity.latitude),
        longitude: String(selectedCity.longitude),
        start_date: startDate,
        end_date: endDate,
        daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max",
        timezone: "Asia/Shanghai",
      });
      const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text.slice(0, 120)}`);
      }
      const json = await res.json();
      if (!json.daily) throw new Error("No daily data returned");
      setData(json.daily as DailyData);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedCity, startDate, endDate]);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q || q.length < 1) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=zh&format=json`);
      if (!res.ok) return;
      const json = await res.json();
      const results: City[] = (json.results || [])
        .filter((r: any) => r.country_code === "CN" && r.latitude && r.longitude)
        .map((r: any) => ({
          name: `${r.name}${r.admin1 ? `, ${r.admin1}` : ""}`,
          latitude: r.latitude,
          longitude: r.longitude,        }));
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  }, []);

  const selectSearchResult = useCallback((city: City) => {
    setSelectedCity(city);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  const avgTemp = useMemo(() => {
    if (!data || !data.temperature_2m_max.length) return "0";
    const all = [...data.temperature_2m_max, ...data.temperature_2m_min];
    return (all.reduce((a, b) => a + b, 0) / all.length).toFixed(1);
  }, [data]);

  const totalPrecip = useMemo(() => {
    if (!data || !data.precipitation_sum.length) return "0";
    return data.precipitation_sum.reduce((a, b) => a + b, 0).toFixed(1);
  }, [data]);

  const avgWind = useMemo(() => {
    if (!data || !data.wind_speed_10m_max.length) return "0";
    const sum = data.wind_speed_10m_max.reduce((a, b) => a + b, 0);
    return (sum / data.wind_speed_10m_max.length).toFixed(1);
  }, [data]);

  const todayWeather = useMemo(() => {
    if (!data || !data.time.length) return null;
    const idx = data.time.length - 1;
    const code = data.weather_code[idx];
    return {
      emoji: WMO_EMOJI[String(code)] ?? "\u2753",
      label: WMO_LABEL[String(code)] ?? "\u672a\u77e5",
    };
  }, [data]);
  const tempOption = useMemo(() => {
    if (!data) return null;
    return {
      tooltip: { trigger: "axis" as const },
      legend: { data: ["最高温 (°C)", "最低温 (°C)"], bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8 },
      grid: { left: 50, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: "category" as const,
        data: data.time,
        axisLabel: { rotate: 45, fontSize: 10, interval: Math.max(0, Math.floor(data.time.length / 20) - 1) },
      },
      yAxis: { type: "value" as const, name: "°C", nameTextStyle: { fontSize: 11 } },
      series: [
        {
          name: "最高温 (°C)",
          type: "line" as const,
          data: data.temperature_2m_max,
          smooth: true,
          lineStyle: { width: 2 },
          itemStyle: { color: "#ef4444" },
          areaStyle: { color: "rgba(239, 68, 68, 0.08)" },
          symbol: "circle" as const,
          symbolSize: 4,
        },
        {
          name: "最低温 (°C)",
          type: "line" as const,
          data: data.temperature_2m_min,
          smooth: true,
          lineStyle: { width: 2 },
          itemStyle: { color: "#3b82f6" },
          areaStyle: { color: "rgba(59, 130, 246, 0.08)" },
          symbol: "circle" as const,
          symbolSize: 4,
        },
      ],
    };
  }, [data]);

  const precipOption = useMemo(() => {
    if (!data) return null;
    return {
      tooltip: { trigger: "axis" as const },
      grid: { left: 50, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: "category" as const,
        data: data.time,
        axisLabel: { rotate: 45, fontSize: 10, interval: Math.max(0, Math.floor(data.time.length / 20) - 1) },
      },
      yAxis: { type: "value" as const, name: "mm", nameTextStyle: { fontSize: 11 } },
      series: [
        {
          name: "降水量",
          type: "bar" as const,
          data: data.precipitation_sum,
          itemStyle: { color: "#06b6d4", borderRadius: [2, 2, 0, 0] },
        },
      ],
    };
  }, [data]);

  const windOption = useMemo(() => {
    if (!data) return null;
    return {
      tooltip: { trigger: "axis" as const },
      grid: { left: 50, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: "category" as const,
        data: data.time,
        axisLabel: { rotate: 45, fontSize: 10, interval: Math.max(0, Math.floor(data.time.length / 20) - 1) },
      },
      yAxis: { type: "value" as const, name: "km/h", nameTextStyle: { fontSize: 11 } },
      series: [
        {
          name: "最大风速",
          type: "line" as const,
          data: data.wind_speed_10m_max,
          smooth: true,
          lineStyle: { width: 2 },
          itemStyle: { color: "#10b981" },
          areaStyle: { color: "rgba(16, 185, 129, 0.08)" },
          symbol: "circle" as const,
          symbolSize: 4,
        },
      ],
    };
  }, [data]);

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              <CloudSun className="h-4 w-4" /> 天气数据
            </h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">
              基于 Open-Meteo 开源天气 API 的中国城市历史天气数据
            </p>
          </div>
          <button
            onClick={fetchWeather}
            disabled={loading}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors",
              "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {loading ? "加载中..." : "刷新"}
          </button>
        </div>

        {/* Controls */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
                  "border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700",
                )}
              >
                <MapPin className="h-3.5 w-3.5 text-neutral-400" />
                {selectedCity.name}
              </button>
              {searchOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                    <input
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                      placeholder="搜索中国城市..."
                      className="w-full rounded-md border border-neutral-200 bg-neutral-50 py-1.5 pl-8 pr-2 text-[12px] outline-none placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {searchResults.map((city, i) => (
                      <button
                        key={i}
                        onClick={() => selectSearchResult(city)}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
                      >
                        <MapPin className="h-3 w-3 shrink-0 text-neutral-400" />
                        {city.name}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 max-h-48 overflow-auto border-t border-neutral-100 pt-2 dark:border-neutral-700">
                    <p className="mb-1 px-2 text-[11px] font-medium text-neutral-400">预设城市</p>
                    {CHINESE_CITIES.filter((c) => c.name !== selectedCity.name).slice(0, 8).map((city) => (
                      <button
                        key={city.name}
                        onClick={() => selectSearchResult(city)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
                      >
                        <MapPin className="h-3 w-3 shrink-0 text-neutral-400" />
                        {city.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 rounded-md border border-neutral-200 bg-white px-2.5 text-[12px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            />
            <span className="text-[12px] text-neutral-400">至</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 rounded-md border border-neutral-200 bg-white px-2.5 text-[12px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center rounded-xl border border-neutral-200 bg-white p-12 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            <span className="ml-2 text-[13px] text-neutral-400">正在获取天气数据...</span>
          </div>
        )}

        {/* Summary Cards */}
        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center gap-2 text-[12px] text-neutral-500">
                  <Thermometer className="h-3.5 w-3.5" />
                  平均温度
                </div>
                <p className="mt-1.5 text-xl font-semibold text-neutral-900 dark:text-neutral-100">{avgTemp}°C</p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center gap-2 text-[12px] text-neutral-500">
                  <Droplets className="h-3.5 w-3.5" />
                  总降水量
                </div>
                <p className="mt-1.5 text-xl font-semibold text-neutral-900 dark:text-neutral-100">{totalPrecip} mm</p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center gap-2 text-[12px] text-neutral-500">
                  <Wind className="h-3.5 w-3.5" />
                  平均风速
                </div>
                <p className="mt-1.5 text-xl font-semibold text-neutral-900 dark:text-neutral-100">{avgWind} km/h</p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center gap-2 text-[12px] text-neutral-500">
                  <CloudSun className="h-3.5 w-3.5" />
                  今日天气
                </div>
                <p className="mt-1.5 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                  {todayWeather ? `${todayWeather.emoji} ${todayWeather.label}` : "--"}
                </p>
              </div>
            </div>

            {/* Charts */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="mb-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">温度趋势</h2>
              <Suspense fallback={<ChartFallback />}>
                {tempOption && <ReactECharts option={tempOption} style={{ height: 240 }} notMerge lazyUpdate />}
              </Suspense>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="mb-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">降水分布</h2>
                <Suspense fallback={<ChartFallback />}>
                  {precipOption && <ReactECharts option={precipOption} style={{ height: 240 }} notMerge lazyUpdate />}
                </Suspense>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="mb-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">风速变化</h2>
                <Suspense fallback={<ChartFallback />}>
                  {windOption && <ReactECharts option={windOption} style={{ height: 240 }} notMerge lazyUpdate />}
                </Suspense>
              </div>
            </div>

            {/* Attribution */}
            <div className="text-center text-[11px] text-neutral-400">
              <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-neutral-600 dark:hover:text-neutral-300">
                Weather data by Open-Meteo.com
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}