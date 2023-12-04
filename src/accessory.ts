import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from "homebridge";

import got from "got";

/*
 * IMPORTANT NOTICE
 *
 * One thing you need to take care of is, that you never ever ever import anything directly from the "homebridge" module (or the "hap-nodejs" module).
 * The above import block may seem like, that we do exactly that, but actually those imports are only used for types and interfaces
 * and will disappear once the code is compiled to Javascript.
 * In fact you can check that by running `npm run build` and opening the compiled Javascript file in the `dist` folder.
 * You will notice that the file does not contain a `... = require("homebridge");` statement anywhere in the code.
 *
 * The contents of the above import statement MUST ONLY be used for type annotation or accessing things like CONST ENUMS,
 * which is a special case as they get replaced by the actual value and do not remain as a reference in the compiled code.
 * Meaning normal enums are bad, const enums can be used.
 *
 * You MUST NOT import anything else which remains as a reference in the code, as this will result in
 * a `... = require("homebridge");` to be compiled into the final Javascript code.
 * This typically leads to unexpected behavior at runtime, as in many cases it won't be able to find the module
 * or will import another instance of homebridge causing collisions.
 *
 * To mitigate this the {@link API | Homebridge API} exposes the whole suite of HAP-NodeJS inside the `hap` property
 * of the api object, which can be acquired for example in the initializer function. This reference can be stored
 * like this for example and used to access all exported variables and classes from HAP-NodeJS.
 */
let hap: HAP;

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;
  api.registerAccessory("NexiaThermostat", NexiaThermostat);
};

class NexiaThermostat {

  private readonly log: Logging;
  private readonly name: string;
  private switchOn = false;

  private readonly apiroute: string;
  private readonly houseId: string;
  private readonly thermostatIndex: number;
  private readonly ZoneId: number;
  private readonly xMobileId: string;
  private readonly xApiKey: string;
  private readonly xAppVersion: string;
  private readonly xAssociatedBrand: string;
  private readonly manufacturer: string;
  private readonly model: string;
  private readonly config: any;
  private readonly serialNumber: string;
  private readonly api: any;
  private readonly Service: any;
  private readonly Characteristic: any;
  private readonly service: any;
  private readonly gotapiGet: any;
  private readonly gotapiPost: any;
  private readonly characteristicMap: Map<string, number>;
  private readonly scaleMap: Map<string, any>;
  private readonly zoneModeMap: Map<number, string>;
  private currentState: any;
  private accessory: string;
  private currentTemperatureScale: number;

  constructor(log: any, config: any, api: any) {
    this.log = log;
    this.config = config;
    // extract name from config
    this.name = config.name;
    this.accessory = config.accessory;
    this.apiroute = config.apiroute;
    this.houseId = config.houseId;
    this.thermostatIndex = config.thermostatIndex;
    this.xMobileId = config.xMobileId;
    this.xApiKey = config.xApiKey;
    this.ZoneId = config.ZoneId;
    this.xAppVersion = config.xAppVersion || "";
    this.xAssociatedBrand = config.xAssociatedBrand || "";
    
    this.manufacturer = config.manufacturer;
    this.model = config.model;
    this.serialNumber = config.serialNumber;
    this.api = api;
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.characteristicMap = new Map();
    this.characteristicMap.set("HEAT", this.Characteristic.CurrentHeatingCoolingState.HEAT);
    this.characteristicMap.set("COOL", this.Characteristic.CurrentHeatingCoolingState.COOL);
    this.characteristicMap.set("OFF", this.Characteristic.CurrentHeatingCoolingState.OFF);


    this.zoneModeMap = new Map();
    this.zoneModeMap.set(this.Characteristic.TargetHeatingCoolingState.OFF, "OFF");
    this.zoneModeMap.set(this.Characteristic.TargetHeatingCoolingState.HEAT, "HEAT");
    this.zoneModeMap.set(this.Characteristic.TargetHeatingCoolingState.COOL, "COOL");


    this.scaleMap = new Map();
    this.scaleMap.set("f", this.Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
    this.scaleMap.set("c", this.Characteristic.TemperatureDisplayUnits.CELSIUS);
    this.currentTemperatureScale = this.Characteristic.TemperatureDisplayUnits.CELSIUS; //default to C

    const headers: {
      "X-MobileId": string, 
      "X-ApiKey": string, 
      "Content-Type": string, 
      "X-AppVersion"?: string, 
      "X-AssociatedBrand"?: string
    } = {
      "X-MobileId": this.xMobileId,
      "X-ApiKey": this.xApiKey,
      "Content-Type": "application/json"
    }
    if(this.xAppVersion) headers["X-AppVersion"] = this.xAppVersion;
    if(this.xAssociatedBrand) headers["X-AssociatedBrand"] = this.xAssociatedBrand

    this.gotapiGet = got.extend({
      prefixUrl: this.apiroute,
      headers: headers
    });

    this.gotapiPost = got.extend({
      headers: headers
    });

    // create a new Thermostat service
    this.service = new this.Service.Thermostat(this.accessory);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
      .on('get', this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.service.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .on('get', this.handleTargetHeatingCoolingStateGet.bind(this))
      .on('set', this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.Characteristic.CurrentTemperature)
      .on('get', this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.Characteristic.TargetTemperature)
      .on('get', this.handleTargetTemperatureGet.bind(this))
      .on('set', this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
      .on('get', this.handleTemperatureDisplayUnitsGet.bind(this))
      .on('set', this.handleTemperatureDisplayUnitsSet.bind(this));

  }


  makeStatusRequest() {
    const promise = (async () => {
      const body = await this.gotapiGet("houses/" + this.houseId).json();
      const rawData = body.result._links.child[0].data.items[this.thermostatIndex].zones[this.ZoneId];
      return rawData;
    });
    return promise;
  }

  makePostRequest(url: any, payload: { value?: string | undefined; heat?: any; cool?: any; }) {
    
    const promise = (async () => {
      this.log.debug("POST: ", url, payload)
      const body = await this.gotapiPost.post(url, {
        json: payload
      });
    });
    return promise;
  }


  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */

  parseRawData(rawData: { current_zone_mode: any; features: any[]; temperature: any; heating_setpoint: any; cooling_setpoint: any; }) {
    const rawMode = rawData.current_zone_mode;
    let mappedMode = this.characteristicMap.get(rawMode);
    
    const rawThermostatFeature = rawData.features.find((e: { name: string; }) => e.name == "thermostat");
    const rawThermostatMode = rawData.features.find((e: { name: string; }) => e.name == "thermostat_mode");
    const rawScale = rawThermostatFeature.scale;
    
    const zoneModeUrl = rawThermostatMode.actions.update_thermostat_mode.href;
    let setPointUrl;
    if (rawThermostatFeature.actions.set_heat_setpoint != null) {
      setPointUrl = rawThermostatFeature.actions.set_heat_setpoint.href;
    } else if (rawThermostatFeature.actions.set_cool_setpoint != null) {
      setPointUrl = rawThermostatFeature.actions.set_cool_setpoint.href;
    } else {
      setPointUrl = zoneModeUrl.replace('zone_mode', 'setpoints');
    }
    const convertedScale = this.scaleMap.get(rawScale);
    const rawTemperature = rawData.temperature;
    const rawHeatingSetPoint = rawData.heating_setpoint;
    const rawCoolingSetPoint = rawData.cooling_setpoint;
    
    let targetTemperature;

    if (mappedMode == this.Characteristic.CurrentHeatingCoolingState.HEAT) {
      targetTemperature = this.convertTemperature(convertedScale, this.currentTemperatureScale, rawHeatingSetPoint);
    } else {
      targetTemperature = this.convertTemperature(convertedScale, this.currentTemperatureScale, rawCoolingSetPoint);
    }
    
    const state = {
      "rawData": rawData,
      "mappedMode": mappedMode,
      "rawTemperature": rawTemperature,
      "rawScale": rawScale,
      "scale": convertedScale,
      "temperature": this.convertTemperature(convertedScale, this.currentTemperatureScale, rawTemperature),
      ...(rawHeatingSetPoint !== 0 ? { "heatingSetpoint": this.convertTemperature(convertedScale, this.currentTemperatureScale, rawHeatingSetPoint) } : {}),
      ...(rawCoolingSetPoint !== 0 ? { "coolingSetpoint": this.convertTemperature(convertedScale, this.currentTemperatureScale, rawCoolingSetPoint) } : {}),
      "targetTemperature": targetTemperature,
      "zoneModelUrl": zoneModeUrl,
      "setPointUrl": setPointUrl
    };

    this.currentState = state;
    return state;
  }

  computeState(callback: any) {
    const promise = this.makeStatusRequest();
    promise()
      .then(rawData => {
        return this.parseRawData(rawData);
      })
      .then(state => {
        callback(state);
      })
      .catch(e => {
        this.log.error("Error getting raw data. Error = " + e.message);
        callback(this.currentState);
      });
  }

  handleCurrentHeatingCoolingStateGet(callback: (arg0: null, arg1: any) => void) {
    this.log.debug('Triggered GET CurrentHeatingCoolingState');
    this.computeState((state: { mappedMode: any; }) => {
      this.log.debug("target heating/cooling state", state);
      callback(null, state.mappedMode);
    });
  }

  convertFahrenheitToCelcius(value: number) {
    const rawConversion = (value - 32) * (5 / 9);
    return Math.round(rawConversion*10)/10; //Round to the nearest 1/10th
  }

  convertCelciusToFahrenheit(value: number) {
    return Math.round((value * (9 / 5)) + 32); //Always round out fahrenheit.
  }

  convertTemperature(fromScale: number, toScale: number, value: number) {
    if (toScale != fromScale) {
      if (toScale == this.Characteristic.TemperatureDisplayUnits.CELSIUS) {
        return this.convertFahrenheitToCelcius(value);
      } else {
        return this.convertCelciusToFahrenheit(value);
      }
    } else {
      return value; //scale matches currentScale.
    }
  }
  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateGet(callback: any) {
    this.log.debug('Triggered GET TargetHeatingCoolingState');

    this.computeState((state: { mappedMode: string; }) => { 
      this.log.debug("target heating/cooling state", state);
      callback(null, state.mappedMode); });
  }


  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateSet(value: any, callback: (arg0: null) => void) {
    this.log.debug('Triggered SET TargetHeatingCoolingState:' + value);
    this.computeState((state: { zoneModelUrl: string; }) => {
      this.makePostRequest(state.zoneModelUrl, { value: this.zoneModeMap.get(value) })()
      .then(v => callback(null))
      .catch(e => {
        this.log.error("Error setting target heating/cooling state.", e.message, e.options);
        callback(null);
      });
    });
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet(callback: (arg0: null, arg1: number) => void) {
    this.log.debug('Triggered GET CurrentTemperature');
    this.computeState((state: { temperature: number; }) => { 
      this.log.debug("current temperature", state);
      callback(null, state.temperature); });
  }


  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet(callback: (arg0: null, arg1: number) => void) {
    this.log.debug('Triggered GET TargetTemperature');
    this.computeState((state: { targetTemperature: number; }) => { 
      this.log.debug("target temperature", state);
      callback(null, state.targetTemperature); });
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  handleTargetTemperatureSet(value: any, callback: (arg0: null) => void) {
    this.log.debug('Triggered SET TargetTemperature:' + value);
    this.computeState((state: { heatingSetpoint: any; coolingSetpoint: any; mappedMode: any; setPointUrl: string, scale: number }) => {

      const targetHeatingTemperature = this.convertTemperature(this.currentTemperatureScale, state.scale, state.heatingSetpoint);
      const targetCoolingTemperature = this.convertTemperature(this.currentTemperatureScale, state.scale, state.coolingSetpoint);

      const payload = { 
        heat: targetHeatingTemperature === 0 ? null : targetHeatingTemperature,
        cool: targetCoolingTemperature === 0 ? null : targetCoolingTemperature
      }
      const thermostatTemperature = this.convertTemperature(this.currentTemperatureScale, state.scale, value);
      if (state.mappedMode == this.Characteristic.CurrentHeatingCoolingState.HEAT) {
        payload.heat = thermostatTemperature;
      } else if (state.mappedMode == this.Characteristic.CurrentHeatingCoolingState.COOL) {
        payload.cool = thermostatTemperature;
      } else {
        payload.heat = thermostatTemperature;
        payload.cool = thermostatTemperature;
      }
      this.log.debug("payload temperature set", payload);
      this.makePostRequest(state.setPointUrl, payload)()
      .then(v => callback(null))
      .catch(e => {
        this.log.error("Error setting target temperature", e.message, e.options)
      });
    })
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet(callback: (arg0: null, arg1: any) => void) {
    this.log.debug('Triggered GET TemperatureDisplayUnits');

    this.computeState((state: { scale: number; }) => { 
      this.log.debug("scale", state);
      callback(null, state.scale); });
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsSet(value: any, callback: (arg0: null) => void) {
    this.log.debug('Triggered SET TemperatureDisplayUnits:' + value);
    callback(null);
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Homebridge-Nexia!");
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.service
    ];
  }

}
