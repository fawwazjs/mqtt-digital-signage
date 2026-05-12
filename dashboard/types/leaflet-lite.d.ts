declare namespace L {
  type LatLngTuple = readonly [number, number];

  interface Point {
    readonly x: number;
    readonly y: number;
  }

  interface LeafletMouseEvent {
    readonly containerPoint: Point;
  }

  interface Map {
    invalidateSize(): void;
    getZoom(): number;
    setView(center: LatLngTuple, zoom?: number, options?: { readonly animate?: boolean }): Map;
    fitBounds(bounds: LatLngBounds, options?: FitBoundsOptions): void;
    on(eventName: "click" | "zoom", handler: (event: LeafletMouseEvent) => void): void;
  }

  interface Marker {
    addTo(map: Map): Marker;
    on(eventName: "mouseover" | "mouseout" | "click", handler: (event: LeafletMouseEvent) => void): void;
    setIcon(icon: DivIcon): Marker;
    getElement(): HTMLElement | null;
  }

  interface Circle {
    addTo(map: Map): Circle;
    remove(): void;
    setStyle(style: CircleOptions): Circle;
  }

  interface TileLayer {
    addTo(map: Map): TileLayer;
  }

  interface LatLngBounds {}
  interface DivIcon {}

  interface MapOptions {
    readonly zoomControl?: boolean;
    readonly attributionControl?: boolean;
  }

  interface TileLayerOptions {
    readonly attribution?: string;
    readonly subdomains?: string;
    readonly maxZoom?: number;
  }

  interface FitBoundsOptions {
    readonly padding?: readonly [number, number];
  }

  interface DivIconOptions {
    readonly className: string;
    readonly html: string;
    readonly iconSize: readonly [number, number];
    readonly iconAnchor: readonly [number, number];
  }

  interface MarkerOptions {
    readonly icon?: DivIcon;
    readonly riseOnHover?: boolean;
  }

  interface CircleOptions {
    readonly radius?: number;
    readonly color?: string;
    readonly fillColor?: string;
    readonly fillOpacity?: number;
    readonly weight?: number;
    readonly opacity?: number;
    readonly interactive?: boolean;
  }

  interface ZoomControl {
    addTo(map: Map): ZoomControl;
  }

  namespace control {
    function zoom(options?: { position?: string }): ZoomControl;
  }

  function map(element: HTMLElement, options?: MapOptions): Map;
  function tileLayer(url: string, options?: TileLayerOptions): TileLayer;
  function latLngBounds(latlngs: readonly LatLngTuple[]): LatLngBounds;
  function divIcon(options: DivIconOptions): DivIcon;
  function marker(latlng: LatLngTuple, options?: MarkerOptions): Marker;
  function circle(latlng: LatLngTuple, options?: CircleOptions): Circle;

  namespace DomEvent {
    function stopPropagation(event: LeafletMouseEvent): void;
  }
}
