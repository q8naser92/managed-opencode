using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Exercises production HTTP polling and rendering against a message-page fixture.
static class NativeMessageTests {
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    [STAThread] static int Main(string[] args){
        try{Run(args[0]);Console.WriteLine("Native message polling and timeout handling: 10 checks passed.");return 0;}
        catch(Exception error){Console.Error.WriteLine(error);return 1;}
    }
    static void Run(string assembly){
        var type=Assembly.LoadFrom(assembly).GetType("ManagedClient",true);
        using(var form=(Form)Activator.CreateInstance(type,true)){
            var handler=new Messages();using(var http=new HttpClient(handler)){
                Set(type,form,"local",http);Set(type,form,"localOrigin","http://127.0.0.1:12345");Set(type,form,"sessionID","test-session");
                var call=type.GetMethod("RefreshMessages",BindingFlags.Instance|BindingFlags.NonPublic);
                Pump((Task)call.Invoke(form,null));
                var transcript=(RichTextBox)Get(type,form,"transcript");var status=(Label)Get(type,form,"status");
                Check(handler.RequestedNewest,"Poll must request newest message page");
                Check(!transcript.Text.Contains("old-000"),"Oldest messages must not freeze the page");
                Check(transcript.Text.Contains("Showing the latest 200 messages."),"Bounded history must be visible");
                Check(transcript.Text.Contains("LATE_TOOL_FAILURE"),"Late tool failure must remain visible");
                Check(transcript.Text.Contains("LATE_IDLE_FAILURE"),"Late idle failure must remain visible");
                Check(transcript.Text.IndexOf("latest-user")<transcript.Text.IndexOf("LATE_TOOL_FAILURE"),"Render newest page in chronological order");
                Check(status.Text=="Work ended with an error.","Newest idle must determine activity");
                handler.Running=true;Pump((Task)call.Invoke(form,null));
                Check(status.Text=="OpenCode is working."&&transcript.Text.Contains("next-user"),"New prompt after failed idle must update the display");
                var run=type.GetMethod("Run",BindingFlags.Instance|BindingFlags.NonPublic);
                Pump((Task)run.Invoke(form,new object[]{new Func<Task>(delegate{throw new TaskCanceledException();})}));
                Check(status.Text.StartsWith("Request timed out."),"Transport timeout must be visible");
                status.Text="Managed work stopped.";
                Pump((Task)run.Invoke(form,new object[]{new Func<Task>(delegate{throw new OperationCanceledException();})}));
                Check(status.Text=="Managed work stopped.","User cancellation must preserve its status");
            }
        }
    }
    sealed class Messages:HttpMessageHandler{
        internal bool RequestedNewest,Running;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancel){
            RequestedNewest=request.RequestUri.PathAndQuery=="/api/session/test-session/message?limit=200&order=desc";
            var messages=new List<object>();
            for(int i=0;i<201;i++)messages.Add(new{type="user",text="old-"+i.ToString("000")});
            messages.Add(new{type="idle",outcome="succeeded"});messages.Add(new{type="user",text="latest-user"});
            messages.Add(new{type="assistant",content=new object[]{new{type="tool",name="read",state=new{status="error",error=new{message="LATE_TOOL_FAILURE"}}}}});
            messages.Add(new{type="idle",outcome="failed",error=new{message="LATE_IDLE_FAILURE"}});
            if(Running)messages.Add(new{type="user",text="next-user"});
            var page=RequestedNewest?messages.AsEnumerable().Reverse().Take(200):messages.Take(200);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(Json.Serialize(new{data=page.ToArray(),cursor=new{next="older-page"}}))});
        }
    }
    static object Get(Type type,object target,string name){return type.GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).GetValue(target);}
    static void Pump(Task task){var end=DateTime.UtcNow.AddSeconds(10);while(!task.IsCompleted){if(DateTime.UtcNow>end)throw new TimeoutException("Message polling did not finish");Application.DoEvents();Thread.Sleep(10);}task.GetAwaiter().GetResult();}
    static void Set(Type type,object target,string name,object value){type.GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).SetValue(target,value);}
    static void Check(bool pass,string message){if(!pass)throw new Exception(message);}
}
