using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

static class NativeEngineJobTests {
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static readonly string DirectoryRoot="C:\\HarnessLab\\clients\\A";
    static int Main(){try{Run().GetAwaiter().GetResult();return 0;}catch(Exception error){File.WriteAllText(Path.Combine(DirectoryRoot,"native-engine-job-result.json"),Json.Serialize(new{pass=false,error=error.GetType().Name+": "+error.Message}));return 1;}}
    static async Task Run(){
        ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
        if(Environment.UserName!="HarnessUserA")throw new Exception("Run as the standard lab user");
        var settings=Map(Json.DeserializeObject(File.ReadAllText(Path.Combine(DirectoryRoot,"central-fixture.json"))));
        var cached=Map(Json.DeserializeObject(File.ReadAllText(Path.Combine(DirectoryRoot,"central-test-session.json"))));
        var env=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        foreach(DictionaryEntry item in Environment.GetEnvironmentVariables()){string name=(string)item.Key;if(name.StartsWith("BUN_",StringComparison.OrdinalIgnoreCase)||name.StartsWith("OPENCODE_",StringComparison.OrdinalIgnoreCase)||name.StartsWith("MANAGED_OPENCODE_",StringComparison.OrdinalIgnoreCase)||name.StartsWith("NODE_",StringComparison.OrdinalIgnoreCase))continue;env[name]=(string)item.Value;}
        using(var remote=new HttpClient(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(10)}){
            remote.DefaultRequestHeaders.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer",(string)cached["token"]);
            var access=await remote.PostAsync((string)settings["origin"]+"/api/engine",new StringContent("{}",Encoding.UTF8,"application/json"));access.EnsureSuccessStatusCode();env["MANAGED_OPENCODE_SESSION"]=(string)Map(Json.DeserializeObject(await access.Content.ReadAsStringAsync()))["token"];
        }
        string password=Guid.NewGuid().ToString("N")+Guid.NewGuid().ToString("N");env["OPENCODE_SERVER_PASSWORD"]=password;
        string root=Path.Combine(DirectoryRoot,"native-job-profile");foreach(string part in new[]{"DATA","CONFIG","CACHE","STATE"}){string path=Path.Combine(root,part.ToLowerInvariant());Directory.CreateDirectory(path);env["XDG_"+part+"_HOME"]=path;}
        string workspace=Path.Combine(DirectoryRoot,"central-workspace");string marker=Path.Combine(workspace,"native-job-child.pid");if(File.Exists(marker))File.Delete(marker);
        var occupied=new TcpListener(IPAddress.Loopback,0);occupied.Start();
        int enginePid=0,childPid=0,selectedPort=0;
        try{
            using(var job=new EngineJob("C:\\Program Files\\ManagedOpenCodeCentral\\Client\\opencode-engine.exe","serve --hostname 127.0.0.1 --port 0",workspace,env)){
                enginePid=job.ProcessId;string origin=await job.ListeningOrigin();selectedPort=new Uri(origin).Port;
                if(new Uri(origin).Host!="127.0.0.1"||selectedPort==((IPEndPoint)occupied.LocalEndpoint).Port)throw new Exception("Local port binding failed");
                using(var local=new HttpClient(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(15)}){
                    local.DefaultRequestHeaders.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Basic",Convert.ToBase64String(Encoding.UTF8.GetBytes("opencode:"+password)));
                    bool ready=false;for(int n=0;n<100;n++){using(var response=await local.GetAsync(origin+"/api/session?limit=1")){if(response.IsSuccessStatusCode){ready=true;break;}}await Task.Delay(100);}if(!ready)throw new Exception("Local engine readiness failed");
                    string command="$child=Start-Process -FilePath $env:ComSpec -ArgumentList '/c ping 127.0.0.1 -n 120 >nul' -WindowStyle Hidden -PassThru; [IO.File]::WriteAllText('"+marker+"',[string]$child.Id); Start-Sleep -Seconds 60";
                    var started=await local.PostAsync(origin+"/api/shell",new StringContent(Json.Serialize(new{command,cwd=workspace,timeout=60000}),Encoding.UTF8,"application/json"));started.EnsureSuccessStatusCode();
                    for(int n=0;n<50&&!File.Exists(marker);n++)await Task.Delay(100);
                    childPid=int.Parse(File.ReadAllText(marker));if(!Alive(childPid)||!job.Running)throw new Exception("Owned processes did not start");
                }
            }
            for(int n=0;n<50&&(Alive(enginePid)||Alive(childPid));n++)await Task.Delay(100);
            if(Alive(enginePid)||Alive(childPid))throw new Exception("Closing the job did not stop the engine and descendant");
            var result=new{pass=true,user=Environment.UserName,actualEngine=true,engineSelectedPort=selectedPort,loopbackOnly=true,occupiedPortAvoided=true,authenticatedLocalConnection=true,ownedDescendantStopped=true};
            File.WriteAllText(Path.Combine(DirectoryRoot,"native-engine-job-result.json"),Json.Serialize(result));Console.WriteLine(Json.Serialize(result));
        }finally{occupied.Stop();}
    }
    static bool Alive(int id){if(id<=0)return false;try{using(var process=Process.GetProcessById(id))return !process.HasExited;}catch(ArgumentException){return false;}}
    static IDictionary<string,object> Map(object value){return (IDictionary<string,object>)value;}
}
