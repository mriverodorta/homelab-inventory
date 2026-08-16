import { SelectField, TextField } from './field-primitives'
import type { InventoryTypeFieldsProps } from './type-fields'
import {
  NETWORK_FORM_FACTORS,
  NETWORK_HOST_INTERFACE_FAMILIES,
  NETWORK_TECHNOLOGIES,
} from './options'

export function NetworkAdapterFields({ values, onChange, onSelectOpenChange }: InventoryTypeFieldsProps) {
  const radio = values.networkTechnology === 'wifi' || values.networkTechnology === 'cellular'
  const family = values.networkHostInterfaceFamily

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <SelectField label="Technology" name="networkTechnology" value={values.networkTechnology} options={NETWORK_TECHNOLOGIES} onOpenChange={onSelectOpenChange} onValueChange={(networkTechnology) => onChange({ networkTechnology }, 'immediate')} />
      <TextField label="Controller" name="networkController" value={values.networkController} placeholder="Intel X710" onChange={(networkController) => onChange({ networkController })} />
      <SelectField label="Form factor" name="networkFormFactor" value={values.networkFormFactor} placeholder="Select form factor" options={NETWORK_FORM_FACTORS} onOpenChange={onSelectOpenChange} onValueChange={(networkFormFactor) => onChange({ networkFormFactor }, 'immediate')} />
      <SelectField label="Host interface" name="networkHostInterfaceFamily" value={family} options={NETWORK_HOST_INTERFACE_FAMILIES} onOpenChange={onSelectOpenChange} onValueChange={(networkHostInterfaceFamily) => onChange({ networkHostInterfaceFamily }, 'immediate')} />

      {family === 'pcie' ? (
        <>
          <TextField label="PCIe generation" name="networkPcieGeneration" value={values.networkPcieGeneration} placeholder="3" type="number" min={1} onChange={(networkPcieGeneration) => onChange({ networkPcieGeneration })} />
          <TextField label="Connector lanes" name="networkConnectorLanes" value={values.networkConnectorLanes} placeholder="8" type="number" min={1} onChange={(networkConnectorLanes) => onChange({ networkConnectorLanes })} />
          <TextField label="Minimum electrical lanes" name="networkMinimumElectricalLanes" value={values.networkMinimumElectricalLanes} placeholder="4" type="number" min={1} onChange={(networkMinimumElectricalLanes) => onChange({ networkMinimumElectricalLanes })} />
        </>
      ) : null}
      {family === 'm2-ae' || family === 'm2-bm' ? (
        <>
          <TextField label="M.2 key" name="networkInterfaceKey" value={values.networkInterfaceKey} placeholder="A+E" onChange={(networkInterfaceKey) => onChange({ networkInterfaceKey })} />
          <TextField label="Module size" name="networkModuleSize" value={values.networkModuleSize} placeholder="2230" onChange={(networkModuleSize) => onChange({ networkModuleSize })} />
        </>
      ) : null}
      {family === 'usb' ? (
        <>
          <TextField label="USB generation" name="networkUsbGeneration" value={values.networkUsbGeneration} placeholder="USB 3.2 Gen 2" onChange={(networkUsbGeneration) => onChange({ networkUsbGeneration })} />
          <TextField label="USB connector" name="networkConnector" value={values.networkConnector} placeholder="USB-C" onChange={(networkConnector) => onChange({ networkConnector })} />
        </>
      ) : null}
      {family === 'ocp' ? <TextField label="OCP version" name="networkOcpVersion" value={values.networkOcpVersion} placeholder="3.0" onChange={(networkOcpVersion) => onChange({ networkOcpVersion })} /> : null}
      {family === 'mezzanine' || family === 'proprietary' || family === 'onboard' ? <TextField label="Interface key" name="networkInterfaceKey" value={values.networkInterfaceKey} placeholder="Platform interface" onChange={(networkInterfaceKey) => onChange({ networkInterfaceKey })} /> : null}

      {!radio ? <TextField label="Maximum speed (Gbps)" name="networkMaxSpeedGbps" value={values.networkMaxSpeedGbps} placeholder="10" type="number" min={0} step="0.1" onChange={(networkMaxSpeedGbps) => onChange({ networkMaxSpeedGbps })} /> : null}
      {radio ? (
        <>
          <TextField label="Maximum PHY rate (Gbps)" name="networkMaxPhyRateGbps" value={values.networkMaxPhyRateGbps} placeholder="2.4" type="number" min={0} step="0.1" onChange={(networkMaxPhyRateGbps) => onChange({ networkMaxPhyRateGbps })} />
          <TextField label="Spatial streams" name="networkSpatialStreams" value={values.networkSpatialStreams} placeholder="2" type="number" min={1} onChange={(networkSpatialStreams) => onChange({ networkSpatialStreams })} />
          <TextField label="Wi-Fi generations" name="networkWifiGenerations" value={values.networkWifiGenerations} placeholder="Wi-Fi 6, Wi-Fi 6E" onChange={(networkWifiGenerations) => onChange({ networkWifiGenerations })} />
          <TextField label="Frequency bands (GHz)" name="networkFrequencyBandsGhz" value={values.networkFrequencyBandsGhz} placeholder="2.4, 5, 6" onChange={(networkFrequencyBandsGhz) => onChange({ networkFrequencyBandsGhz })} />
          <TextField label="Bluetooth version" name="networkBluetoothVersion" value={values.networkBluetoothVersion} placeholder="5.3" onChange={(networkBluetoothVersion) => onChange({ networkBluetoothVersion })} />
          <TextField label="Antenna topology" name="networkAntennaTopology" value={values.networkAntennaTopology} placeholder="2x2" onChange={(networkAntennaTopology) => onChange({ networkAntennaTopology })} />
        </>
      ) : null}
      <TextField label="Operating modes" name="networkOperatingModes" value={values.networkOperatingModes} placeholder={radio ? 'wifi' : 'ethernet, converged'} onChange={(networkOperatingModes) => onChange({ networkOperatingModes })} />
    </div>
  )
}
