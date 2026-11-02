' CPU, RAM and GPU percentages for the my-brand rings, from Windows' own
' performance classes (no third-party tools, no polling loop of its own).
' Prints "cpu|ram|gpu"; -1 where a value could not be read.
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
cpu = -1 : ram = -1 : gpu = -1
If Err.Number = 0 Then
  For Each p In wmi.ExecQuery("SELECT PercentProcessorTime FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name='_Total'")
    cpu = p.PercentProcessorTime
  Next
  For Each o In wmi.ExecQuery("SELECT TotalVisibleMemorySize,FreePhysicalMemory FROM Win32_OperatingSystem")
    If o.TotalVisibleMemorySize > 0 Then ram = Round((o.TotalVisibleMemorySize - o.FreePhysicalMemory) * 100 / o.TotalVisibleMemorySize)
  Next
  For Each g In wmi.ExecQuery("SELECT UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine WHERE Name LIKE '%engtype_3D%'")
    If g.UtilizationPercentage > gpu Then gpu = g.UtilizationPercentage
  Next
End If
WScript.Echo cpu & "|" & ram & "|" & gpu
