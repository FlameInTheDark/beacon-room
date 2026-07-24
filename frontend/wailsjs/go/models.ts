export namespace layout {
	
	export class APISettings {
	    enabled: boolean;
	    port: number;
	
	    static createFrom(source: any = {}) {
	        return new APISettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.port = source["port"];
	    }
	}
	export class StationControlSettings {
	    mode: string;
	    donglePort: string;

	    static createFrom(source: any = {}) {
	        return new StationControlSettings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.donglePort = source["donglePort"];
	    }
	}
	export class StatusRefreshSettings {
	    enabled: boolean;
	    intervalSeconds: number;
	
	    static createFrom(source: any = {}) {
	        return new StatusRefreshSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.intervalSeconds = source["intervalSeconds"];
	    }
	}
	export class NotificationSettings {
	    enabled: boolean;
	    stationStateChanges: boolean;
	    stationErrors: boolean;
	
	    static createFrom(source: any = {}) {
	        return new NotificationSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.stationStateChanges = source["stationStateChanges"];
	        this.stationErrors = source["stationErrors"];
	    }
	}
	export class AppSettings {
	    hideToTray: boolean;
	    api: APISettings;
	    theme: string;
	    notifications: NotificationSettings;
	    statusRefresh: StatusRefreshSettings;
	    stationControl: StationControlSettings;
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hideToTray = source["hideToTray"];
	        this.api = this.convertValues(source["api"], APISettings);
	        this.theme = source["theme"];
	        this.notifications = this.convertValues(source["notifications"], NotificationSettings);
	        this.statusRefresh = this.convertValues(source["statusRefresh"], StatusRefreshSettings);
	        this.stationControl = this.convertValues(source["stationControl"], StationControlSettings);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Point {
	    id: string;
	    x: number;
	    y: number;
	
	    static createFrom(source: any = {}) {
	        return new Point(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.x = source["x"];
	        this.y = source["y"];
	    }
	}
	export class BaseStation {
	    id: string;
	    bluetoothName: string;
	    bluetoothId: string;
	    name: string;
	    position?: Point;
	    poweredOn: boolean;
	    powerState: string;
	    powerError?: string;
	    icon: string;
	    outlineColor: string;
	    coverageAngle: number;
	    coverageRotation: number;
	
	    static createFrom(source: any = {}) {
	        return new BaseStation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.bluetoothName = source["bluetoothName"];
	        this.bluetoothId = source["bluetoothId"];
	        this.name = source["name"];
	        this.position = this.convertValues(source["position"], Point);
	        this.poweredOn = source["poweredOn"];
	        this.powerState = source["powerState"];
	        this.powerError = source["powerError"];
	        this.icon = source["icon"];
	        this.outlineColor = source["outlineColor"];
	        this.coverageAngle = source["coverageAngle"];
	        this.coverageRotation = source["coverageRotation"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class InteriorShape {
	    id: string;
	    name: string;
	    points: Point[];
	    isTall: boolean;
	
	    static createFrom(source: any = {}) {
	        return new InteriorShape(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.points = this.convertValues(source["points"], Point);
	        this.isTall = source["isTall"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class Room {
	    id: string;
	    name: string;
	    points: Point[];
	    closed: boolean;
	    shapes: InteriorShape[];
	
	    static createFrom(source: any = {}) {
	        return new Room(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.points = this.convertValues(source["points"], Point);
	        this.closed = source["closed"];
	        this.shapes = this.convertValues(source["shapes"], InteriorShape);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class State {
	    room: Room;
	    stations: BaseStation[];
	    setupComplete: boolean;
	    snapStep: number;
	    settings: AppSettings;
	
	    static createFrom(source: any = {}) {
	        return new State(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.room = this.convertValues(source["room"], Room);
	        this.stations = this.convertValues(source["stations"], BaseStation);
	        this.setupComplete = source["setupComplete"];
	        this.snapStep = source["snapStep"];
	        this.settings = this.convertValues(source["settings"], AppSettings);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace lighthouse {
	
	export class PowerResult {
	    bluetoothId: string;
	    resolvedBluetoothId?: string;
	    powerState: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new PowerResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bluetoothId = source["bluetoothId"];
	        this.resolvedBluetoothId = source["resolvedBluetoothId"];
	        this.powerState = source["powerState"];
	        this.error = source["error"];
	    }
	}

}

export namespace main {

	export class UpdateAvailability {
	    available: boolean;
	    version: string;
	    url: string;

	    static createFrom(source: any = {}) {
	        return new UpdateAvailability(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.version = source["version"];
	        this.url = source["url"];
	    }
	}

}
